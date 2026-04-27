import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { evaluateListing } from './filterEngine.js';
import { formatListingMessage } from './messageFormatter.js';
import { selectProfileForListing } from './profileMatcher.js';
import { searchBuckets } from '../config/searchBuckets.js';
import { checkListingAvailability, searchBucketListingsPage } from '../integrations/ebay/client.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { ScannerStateStore } from './scannerState.js';
function isNewerThanCutoff(listing, cutoff) {
    if (!cutoff || !listing.itemOriginDate)
        return true;
    return listing.itemOriginDate > cutoff;
}
const EVENT_LOOP_YIELD_INTERVAL = 50;
export class ScannerService {
    notifier;
    marketReferences;
    isRunning = false;
    bucketWatermarks = new Map();
    state = new ScannerStateStore();
    initializationPromise = null;
    currentRunPromise = null;
    constructor(notifier, marketReferences) {
        this.notifier = notifier;
        this.marketReferences = marketReferences;
    }
    async ensureInitialized() {
        if (!this.initializationPromise) {
            this.initializationPromise = this.state.load();
        }
        await this.initializationPromise;
    }
    async refreshAvailability() {
        await this.ensureInitialized();
        if (this.currentRunPromise) {
            await this.currentRunPromise;
        }
        const dueListings = this.state.getListingsDueForAvailabilityCheck();
        let removalCount = 0;
        let checkedListings = 0;
        let failedChecks = 0;
        for (const record of dueListings) {
            try {
                const availability = await checkListingAvailability(record.listingId);
                checkedListings += 1;
                if (availability.available) {
                    await this.state.recordAvailabilityCheck(record.listingId, availability.checkedAt, 'available', availability.reason);
                    continue;
                }
                await this.state.recordAvailabilityCheck(record.listingId, availability.checkedAt, 'unavailable', availability.reason);
                if (env.SCANNER_AVAILABILITY_UNAVAILABLE_ACTION === 'mark_expired') {
                    if (this.notifier.markUnavailable) {
                        await this.notifier.markUnavailable({
                            messageId: record.notificationMessageId,
                            channelId: record.notificationChannelId,
                        }, {
                            reason: availability.reason,
                            checkedAt: availability.checkedAt,
                        });
                    }
                }
                else {
                    if (this.notifier.delete) {
                        await this.notifier.delete({
                            messageId: record.notificationMessageId,
                            channelId: record.notificationChannelId,
                        });
                    }
                    await this.state.forgetSeen(record.listingId);
                }
                removalCount += 1;
                logger.info({
                    listingId: record.listingId,
                    profile: record.profileName,
                    reason: availability.reason,
                    action: env.SCANNER_AVAILABILITY_UNAVAILABLE_ACTION,
                }, 'Handled unavailable listing notification');
            }
            catch (error) {
                logger.warn({
                    error,
                    listingId: record.listingId,
                    profile: record.profileName,
                }, 'Failed to verify sent listing availability');
                failedChecks += 1;
                await this.state.recordAvailabilityFailure(record.listingId, new Date().toISOString(), error instanceof Error ? error.message : String(error));
            }
        }
        return {
            checkedListings,
            removedListings: removalCount,
            failedChecks,
        };
    }
    async resetState(profiles) {
        await this.ensureInitialized();
        if (this.currentRunPromise) {
            await this.currentRunPromise;
        }
        this.bucketWatermarks.clear();
        const result = await this.state.reset();
        if (profiles) {
            await this.exportMarketDashboard(profiles);
        }
        return result;
    }
    async exportMarketDashboard(profiles) {
        await this.ensureInitialized();
        return this.state.persistMarketDashboardSnapshot(profiles);
    }
    async maybeCreateMarketDigest(profiles, cadence) {
        await this.ensureInitialized();
        if (!this.state.shouldSendDigest(cadence)) {
            return null;
        }
        const digest = this.state.buildMarketDigest(profiles, cadence);
        if (digest.totalAcceptedListings === 0) {
            await this.state.markDigestSent(cadence, digest.generatedAt);
            return null;
        }
        return digest;
    }
    async markMarketDigestSent(cadence, sentAt = new Date().toISOString()) {
        await this.ensureInitialized();
        await this.state.markDigestSent(cadence, sentAt);
    }
    async runOnce(profiles, options = {}) {
        if (this.isRunning) {
            logger.warn('Skipping scan because previous run is still active');
            return {
                uniqueListings: 0,
                acceptedListings: 0,
                seenSkipped: 0,
                alertsPosted: 0,
                notificationFailures: 0,
                availabilityRemovals: 0,
            };
        }
        this.isRunning = true;
        const runPromise = (async () => {
            await this.ensureInitialized();
            const collectedListings = new Map();
            let acceptedListings = 0;
            let seenSkipped = 0;
            let alertsPosted = 0;
            let notificationFailures = 0;
            let scannedListingCount = 0;
            const evaluationMode = options.evaluationMode ?? 'normal';
            const persistState = options.persistState ?? true;
            const runAvailabilityCleanup = options.runAvailabilityCleanup ?? true;
            for (const bucket of searchBuckets) {
                const previousWatermark = options.ignoreBucketWatermarks
                    ? undefined
                    : this.bucketWatermarks.get(bucket.id);
                const nextWatermark = new Date().toISOString();
                logger.info({
                    bucket: bucket.name,
                    query: bucket.query,
                    previousWatermark,
                    ignoreSeen: options.ignoreSeen ?? false,
                    ignoreBucketWatermarks: options.ignoreBucketWatermarks ?? false,
                }, 'Scanning bucket');
                try {
                    let offset = 0;
                    let pageCount = 0;
                    let hasNext = true;
                    let bucketAddedCount = 0;
                    while (hasNext && pageCount < env.EBAY_MAX_PAGES_PER_BUCKET) {
                        const page = await searchBucketListingsPage(bucket, profiles, offset);
                        pageCount += 1;
                        hasNext = page.hasNext;
                        let reachedKnownWindow = false;
                        for (const listing of page.listings) {
                            scannedListingCount += 1;
                            if (scannedListingCount % EVENT_LOOP_YIELD_INTERVAL === 0) {
                                await yieldToEventLoop();
                            }
                            if (!isNewerThanCutoff(listing, previousWatermark)) {
                                reachedKnownWindow = true;
                                break;
                            }
                            if (!collectedListings.has(listing.id)) {
                                collectedListings.set(listing.id, listing);
                                bucketAddedCount += 1;
                            }
                        }
                        if (reachedKnownWindow || page.listings.length === 0) {
                            break;
                        }
                        offset += page.limit;
                    }
                    this.bucketWatermarks.set(bucket.id, nextWatermark);
                    logger.info({
                        bucket: bucket.name,
                        pageCount,
                        bucketAddedCount,
                        totalUniqueListings: collectedListings.size,
                    }, 'Finished bucket scan');
                }
                catch (error) {
                    logger.error({ error, bucket: bucket.name }, 'failed to scan bucket');
                }
            }
            let evaluatedListingCount = 0;
            for (const listing of collectedListings.values()) {
                evaluatedListingCount += 1;
                if (evaluatedListingCount % EVENT_LOOP_YIELD_INTERVAL === 0) {
                    await yieldToEventLoop();
                }
                const match = selectProfileForListing(profiles, listing);
                if (!match)
                    continue;
                const referenceMatch = this.marketReferences?.matchReference(match.profile, listing);
                const result = evaluateListing(match.profile, listing, referenceMatch, { evaluationMode });
                if (!result.accepted)
                    continue;
                acceptedListings += 1;
                if (!options.ignoreSeen && this.state.hasSeen(listing.id)) {
                    seenSkipped += 1;
                    continue;
                }
                if (options.maxAlerts && alertsPosted >= options.maxAlerts) {
                    continue;
                }
                const resultWithStats = {
                    ...result,
                    marketStats: this.state.previewStats(result),
                };
                if (persistState) {
                    await this.state.recordObservation(resultWithStats);
                }
                try {
                    const receipt = (await this.notifier.send(formatListingMessage(resultWithStats))) ?? undefined;
                    if (persistState) {
                        await this.state.recordSent(resultWithStats, receipt);
                    }
                    alertsPosted += 1;
                }
                catch (error) {
                    notificationFailures += 1;
                    logger.error({
                        error,
                        listingId: listing.id,
                        profile: match.profile.name,
                        matchedAlias: match.alias,
                    }, 'failed to send notification');
                }
            }
            const availabilityRefresh = runAvailabilityCleanup
                ? await this.refreshAvailability()
                : { checkedListings: 0, removedListings: 0, failedChecks: 0 };
            if (persistState) {
                try {
                    await this.exportMarketDashboard(profiles);
                }
                catch (error) {
                    logger.warn({ error }, 'Failed to persist market dashboard snapshot');
                }
            }
            return {
                uniqueListings: collectedListings.size,
                acceptedListings,
                seenSkipped,
                alertsPosted,
                notificationFailures,
                availabilityRemovals: availabilityRefresh.removedListings,
            };
        })();
        this.currentRunPromise = runPromise;
        try {
            return await runPromise;
        }
        finally {
            this.currentRunPromise = null;
            this.isRunning = false;
        }
    }
}
