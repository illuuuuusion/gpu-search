import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { evaluateListing } from './filterEngine.js';
import { formatListingMessage } from './messageFormatter.js';
import { selectProfileForListing } from './profileMatcher.js';
import { searchBuckets } from '../config/searchBuckets.js';
import { checkListingAvailability, searchBucketListingsPage } from '../integrations/ebay/client.js';
import type { GpuProfile } from '../types/domain.js';
import type { Notifier } from '../integrations/notifier.js';
import type { EbayListing } from '../types/domain.js';
import type { MarketReferenceReader } from '../integrations/geizhals/referenceService.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { ScannerStateStore, type ScannerStateResetResult } from './scannerState.js';
import type { MarketDashboardSnapshot, MarketDigestMessage } from '../types/domain.js';

function isNewerThanCutoff(listing: EbayListing, cutoff: string | undefined): boolean {
  if (!cutoff || !listing.itemOriginDate) return true;
  return listing.itemOriginDate > cutoff;
}

interface ScannerRunOptions {
  ignoreSeen?: boolean;
  ignoreBucketWatermarks?: boolean;
  persistState?: boolean;
  evaluationMode?: 'normal' | 'debug';
  maxAlerts?: number;
  runAvailabilityCleanup?: boolean;
}

export interface ScannerRunSummary {
  uniqueListings: number;
  acceptedListings: number;
  seenSkipped: number;
  alertsPosted: number;
  notificationFailures: number;
  availabilityRemovals: number;
}

const EVENT_LOOP_YIELD_INTERVAL = 50;

export class ScannerService {
  private isRunning = false;
  private bucketWatermarks = new Map<string, string>();
  private readonly state = new ScannerStateStore();
  private initializationPromise: Promise<void> | null = null;
  private currentRunPromise: Promise<ScannerRunSummary> | null = null;

  constructor(
    private readonly notifier: Notifier,
    private readonly marketReferences?: MarketReferenceReader,
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.state.load();
    }

    await this.initializationPromise;
  }

  private async cleanupUnavailableListings(): Promise<number> {
    const dueListings = this.state.getListingsDueForAvailabilityCheck();
    let removalCount = 0;

    for (const record of dueListings) {
      try {
        const availability = await checkListingAvailability(record.listingId);

        if (availability.available) {
          await this.state.recordAvailabilityCheck(record.listingId, availability.checkedAt);
          continue;
        }

        if (this.notifier.delete) {
          await this.notifier.delete({
            messageId: record.notificationMessageId,
            channelId: record.notificationChannelId,
          });
        }

        await this.state.forgetSeen(record.listingId);
        removalCount += 1;
        logger.info({
          listingId: record.listingId,
          profile: record.profileName,
          reason: availability.reason,
        }, 'Removed unavailable listing notification');
      } catch (error) {
        logger.warn({
          error,
          listingId: record.listingId,
          profile: record.profileName,
        }, 'Failed to verify sent listing availability');
      }
    }

    return removalCount;
  }

  async resetState(profiles?: GpuProfile[]): Promise<ScannerStateResetResult> {
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

  async exportMarketDashboard(profiles: GpuProfile[]): Promise<MarketDashboardSnapshot> {
    await this.ensureInitialized();
    return this.state.persistMarketDashboardSnapshot(profiles);
  }

  async maybeCreateMarketDigest(
    profiles: GpuProfile[],
    cadence: 'daily' | 'weekly',
  ): Promise<MarketDigestMessage | null> {
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

  async markMarketDigestSent(
    cadence: 'daily' | 'weekly',
    sentAt = new Date().toISOString(),
  ): Promise<void> {
    await this.ensureInitialized();
    await this.state.markDigestSent(cadence, sentAt);
  }

  async runOnce(profiles: GpuProfile[], options: ScannerRunOptions = {}): Promise<ScannerRunSummary> {
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
      const collectedListings = new Map<string, EbayListing>();
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
        } catch (error) {
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
        if (!match) continue;

        const referenceMatch = this.marketReferences?.matchReference(match.profile, listing);
        const result = evaluateListing(match.profile, listing, referenceMatch, { evaluationMode });
        if (!result.accepted) continue;
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
        } catch (error) {
          notificationFailures += 1;
          logger.error({
            error,
            listingId: listing.id,
            profile: match.profile.name,
            matchedAlias: match.alias,
          }, 'failed to send notification');
        }
      }

      const availabilityRemovals = runAvailabilityCleanup
        ? await this.cleanupUnavailableListings()
        : 0;
      if (persistState) {
        try {
          await this.exportMarketDashboard(profiles);
        } catch (error) {
          logger.warn({ error }, 'Failed to persist market dashboard snapshot');
        }
      }
      return {
        uniqueListings: collectedListings.size,
        acceptedListings,
        seenSkipped,
        alertsPosted,
        notificationFailures,
        availabilityRemovals,
      };
    })();

    this.currentRunPromise = runPromise;

    try {
      return await runPromise;
    } finally {
      this.currentRunPromise = null;
      this.isRunning = false;
    }
  }
}
