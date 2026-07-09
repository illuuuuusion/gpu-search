import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { evaluateListing } from '../domain/filterEngine.js';
import { formatListingMessage, formatDreamDealMessage, formatArbitrageMessage } from '../domain/messageFormatter.js';
import { selectProfileForListing } from '../domain/profileMatcher.js';
import { calculateDreamDealScore } from '../domain/dreamDealScore.js';
import { assessArbitrage } from '../domain/arbitrage.js';
import { findAliasFallback, logAliasFallback } from '../domain/aliasFallback.js';
import { runtimeExclusionStore, type RuntimeExclusion } from '../domain/runtimeExclusions.js';
import { wouldBlockLegitimateAlias } from '../domain/aliasSimilarity.js';
import { searchBuckets } from '../config/searchBuckets.js';
import { checkListingAvailability, searchBucketListingsPage } from '../infrastructure/ebay/client.js';
import { searchKleinanzeigenListings } from '../infrastructure/kleinanzeigen/client.js';
import type { GpuProfile } from '../domain/models.js';
import type { Notifier } from '../../../app/shared/notifier/index.js';
import type { EbayListing } from '../domain/models.js';
import { logger } from '../../../app/shared/logger.js';
import { env } from '../../../app/env/index.js';
import { ScannerStateStore, type ScannerStateResetResult, type AcceptanceAdjustment, type DreamDealAdjustment, type ReminderScheduleResult } from '../domain/scannerState.js';
import type { MarketDashboardSnapshot, MarketDigestMessage } from '../domain/models.js';
import type { ReactionRoute } from '../../../app/shared/botBindings.js';

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

export interface AvailabilityRefreshSummary {
  checkedListings: number;
  removedListings: number;
  failedChecks: number;
}

const EVENT_LOOP_YIELD_INTERVAL = 50;

export class ScannerService {
  private isRunning = false;
  private bucketWatermarks = new Map<string, string>();
  private readonly state = new ScannerStateStore();
  private initializationPromise: Promise<void> | null = null;
  private currentRunPromise: Promise<ScannerRunSummary> | null = null;

  constructor(private readonly notifier: Notifier) {}

  private async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = Promise.all([
        this.state.load(),
        runtimeExclusionStore.load(),
      ]).then(() => undefined);
    }

    await this.initializationPromise;
  }

  private async loadActiveGpuListingIds(): Promise<Set<string> | null> {
    if (!this.notifier.listActiveGpuListingIds) {
      return null;
    }

    try {
      const listingIds = await this.notifier.listActiveGpuListingIds();
      return new Set(listingIds);
    } catch (error) {
      logger.warn({ error }, 'Failed to load active GPU listing IDs from notifier; falling back to local seen state');
      return null;
    }
  }

  async refreshAvailability(): Promise<AvailabilityRefreshSummary> {
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
        } else {
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
      } catch (error) {
        logger.warn({
          error,
          listingId: record.listingId,
          profile: record.profileName,
        }, 'Failed to verify sent listing availability');
        failedChecks += 1;
        await this.state.recordAvailabilityFailure(
          record.listingId,
          new Date().toISOString(),
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      checkedListings,
      removedListings: removalCount,
      failedChecks,
    };
  }

  async getReactionRoute(messageId: string): Promise<ReactionRoute | null> {
    await this.ensureInitialized();
    const route = this.state.getReactionRoute(messageId);
    if (!route) {
      return null;
    }

    return { type: route.type, profileName: route.profileName, listingId: route.listingId };
  }

  async registerReactionRoute(
    messageId: string,
    route: ReactionRoute & { channelId?: string },
  ): Promise<void> {
    await this.ensureInitialized();
    await this.state.registerReactionRoute({
      messageId,
      channelId: route.channelId,
      type: route.type,
      profileName: route.profileName,
      listingId: route.listingId,
    });
  }

  async applyAcceptanceReaction(profileName: string, direction: 'up' | 'down'): Promise<AcceptanceAdjustment> {
    await this.ensureInitialized();
    return this.state.recordAcceptanceReaction(profileName, direction);
  }

  async resetAcceptanceBias(profileName: string): Promise<AcceptanceAdjustment> {
    await this.ensureInitialized();
    return this.state.resetAcceptanceBias(profileName);
  }

  // C1
  async applyDreamDealReaction(profileName: string, direction: 'up' | 'down'): Promise<DreamDealAdjustment> {
    await this.ensureInitialized();
    return this.state.recordDreamDealReaction(profileName, direction);
  }

  async resetDreamDealBias(profileName: string): Promise<DreamDealAdjustment> {
    await this.ensureInitialized();
    return this.state.resetDreamDealBias(profileName);
  }

  // D
  async scheduleAuctionReminder(input: {
    listingId: string;
    channelId: string;
    messageId: string;
    userId: string;
  }): Promise<ReminderScheduleResult> {
    await this.ensureInitialized();
    return this.state.scheduleAuctionReminder({ ...input, leadMinutes: env.AUCTION_REMINDER_LEAD_MINUTES });
  }

  // C2
  async reportExclusion(input: {
    profileName: string;
    term: string;
    reportedByUserId: string;
    originalListingId: string;
    originalListingTitle: string;
  }): Promise<{ status: 'created' | 'blocked'; blockedBy?: { profileName: string; alias: string }; term: string }> {
    await this.ensureInitialized();
    const trimmed = input.term.trim();
    if (!trimmed) {
      return { status: 'blocked', term: trimmed };
    }
    // Permissive Kalibrierung: nur echte Alias-Kollisionen ablehnen.
    const collision = wouldBlockLegitimateAlias(trimmed, this.profilesRef, env.EXCLUSION_SIMILARITY_MAX_DISTANCE);
    if (collision) {
      return { status: 'blocked', blockedBy: collision, term: trimmed };
    }
    await runtimeExclusionStore.add({
      profileName: input.profileName,
      term: trimmed,
      reportedByUserId: input.reportedByUserId,
      originalListingId: input.originalListingId,
      originalListingTitle: input.originalListingTitle,
    });
    return { status: 'created', term: trimmed };
  }

  private profilesRef: GpuProfile[] = [];

  setProfiles(profiles: GpuProfile[]): void {
    this.profilesRef = profiles;
  }

  async reviewExclusions(days = 30): Promise<RuntimeExclusion[]> {
    await this.ensureInitialized();
    return runtimeExclusionStore.listActive(days);
  }

  async undoExclusion(id: string): Promise<boolean> {
    await this.ensureInitialized();
    return runtimeExclusionStore.revert(id);
  }

  // Reminder-Tick: alle faelligen Reminder abarbeiten, jeweils isoliert (A5).
  async processDueAuctionReminders(): Promise<{ fired: number; cancelled: number; failed: number }> {
    await this.ensureInitialized();
    const due = this.state.getAuctionRemindersDue();
    let fired = 0;
    let cancelled = 0;
    let failed = 0;

    for (const reminder of due) {
      try {
        const availability = await checkListingAvailability(reminder.listingId.replace(/^kleinanzeigen-/, ''));
        if (!availability.available) {
          if (this.notifier.sendReminderCancellation) {
            await this.notifier.sendReminderCancellation(reminder);
          }
          await this.state.markAuctionReminder(reminder.listingId, 'cancelled');
          cancelled += 1;
          continue;
        }

        if (this.notifier.sendAuctionReminder) {
          await this.notifier.sendAuctionReminder({
            ...reminder,
            currentPriceEur: availability.currentPriceEur,
            currentBidCount: availability.currentBidCount,
          });
        }
        await this.state.markAuctionReminder(reminder.listingId, 'fired');
        fired += 1;
      } catch (error) {
        // Ein fehlgeschlagener Reminder darf die anderen im Batch nicht blocken.
        logger.warn({ error, listingId: reminder.listingId }, 'auction reminder failed');
        failed += 1;
      }
    }

    return { fired, cancelled, failed };
  }

  private async runArbitrageScan(profiles: GpuProfile[]): Promise<number> {
    let posted = 0;
    for (const profile of profiles) {
      const resaleReferenceEur = this.state.getResaleReference(profile.name);
      if (!resaleReferenceEur) {
        continue; // ohne eigene Historie keine Wiederverkaufsreferenz
      }

      const query = profile.aliases[0] ?? profile.name;
      const listings = await searchKleinanzeigenListings(query);
      for (const listing of listings) {
        if (this.state.hasSeen(listing.id)) {
          continue;
        }
        const match = selectProfileForListing([profile], listing);
        if (!match) {
          continue;
        }
        const evaluated = evaluateListing(profile, listing);
        if (evaluated.health === 'EXCLUDED') {
          continue;
        }
        const assessment = assessArbitrage({
          buyPriceEur: listing.priceEur,
          buyShippingEur: listing.shippingEur,
          resaleReferenceEur,
        });
        if (!assessment.profitable) {
          continue;
        }

        try {
          const receipt = (await this.notifier.send(formatArbitrageMessage(evaluated, assessment))) ?? undefined;
          await this.state.recordSent(evaluated, receipt);
          posted += 1;
        } catch (error) {
          logger.warn({ error, listingId: listing.id }, 'failed to send arbitrage alert');
        }
      }
    }

    return posted;
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
      // B5: Bias-Decay einmal pro Tick vor der Bewertung anwenden.
      if (env.ADAPTIVE_THRESHOLD_ENABLED) {
        await this.state.applyBiasDecay();
      }
      const collectedListings = new Map<string, EbayListing>();
      let acceptedListings = 0;
      let seenSkipped = 0;
      let alertsPosted = 0;
      let notificationFailures = 0;
      let scannedListingCount = 0;
      const evaluationMode = options.evaluationMode ?? 'normal';
      const persistState = options.persistState ?? true;
      const runAvailabilityCleanup = options.runAvailabilityCleanup ?? true;
      if (persistState) this.state.beginBatch();
      const activeGpuListingIds = options.ignoreSeen
        ? null
        : await this.loadActiveGpuListingIds();

      for (const bucket of searchBuckets) {
        const previousWatermark = options.ignoreBucketWatermarks
          ? undefined
          : this.bucketWatermarks.get(bucket.id);
        const overlapMs = env.SCANNER_BUCKET_WATERMARK_OVERLAP_MINUTES * 60_000;
        const cutoff = previousWatermark
          ? new Date(new Date(previousWatermark).getTime() - overlapMs).toISOString()
          : undefined;
        let maxSeenItemOriginDate: string | undefined;
        logger.info({
          bucket: bucket.name,
          query: bucket.query,
          previousWatermark,
          cutoff,
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

              if (!isNewerThanCutoff(listing, cutoff)) {
                reachedKnownWindow = true;
                break;
              }

              if (listing.itemOriginDate && (!maxSeenItemOriginDate || listing.itemOriginDate > maxSeenItemOriginDate)) {
                maxSeenItemOriginDate = listing.itemOriginDate;
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

          const newWatermark = maxSeenItemOriginDate ?? new Date().toISOString();
          this.bucketWatermarks.set(bucket.id, newWatermark);
          logger.info({
            bucket: bucket.name,
            pageCount,
            bucketAddedCount,
            totalUniqueListings: collectedListings.size,
            newWatermark,
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
        if (!match) {
          // B6: regelbasiertes Alias-Fallback — Near-Miss nur loggen, kein Alarm.
          if (env.ALIAS_FALLBACK_ENABLED) {
            const fallback = findAliasFallback(listing, profiles);
            if (fallback) {
              void logAliasFallback(fallback);
            }
          }
          continue;
        }

        const acceptanceBias = env.ADAPTIVE_THRESHOLD_ENABLED
          ? this.state.getAcceptanceBias(match.profile.name)
          : 0;
        const result = evaluateListing(match.profile, listing, {
          evaluationMode,
          effectiveLimitMultiplier: 1 + acceptanceBias,
        });
        if (!result.accepted) continue;
        acceptedListings += 1;
        const shouldSkipBecauseAlreadyPosted = options.ignoreSeen
          ? false
          : activeGpuListingIds
            ? activeGpuListingIds.has(listing.id)
            : this.state.hasSeen(listing.id);
        if (shouldSkipBecauseAlreadyPosted) {
          seenSkipped += 1;
          continue;
        }
        if (options.maxAlerts && alertsPosted >= options.maxAlerts) {
          continue;
        }

        const listingHealth = result.health === 'DEFECT' ? 'DEFECT' : 'WORKING';
        const dreamDealScore = env.DREAM_DEAL_ENABLED && listingHealth === 'WORKING'
          ? calculateDreamDealScore(result)
          : undefined;
        const resultWithStats = {
          ...result,
          marketStats: this.state.previewStats(result),
          dealTiming: env.DEAL_TIMING_ENABLED
            ? this.state.assessDealTiming(match.profile.name, listingHealth)
            : undefined,
          dreamDealScore,
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

          // C1: zusaetzliche Dream-Deal-Sondernachricht, wenn Score >= Profil-Schwelle.
          if (
            persistState
            && dreamDealScore !== undefined
            && this.notifier.sendDreamDealAlert
            && dreamDealScore >= this.state.getDreamDealThreshold(match.profile.name)
          ) {
            try {
              await this.notifier.sendDreamDealAlert(formatDreamDealMessage(resultWithStats), {
                profileName: match.profile.name,
                listingId: listing.id,
              });
            } catch (error) {
              logger.warn({ error, listingId: listing.id }, 'failed to send dream deal alert');
            }
          }
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

      // B4: Cross-Marketplace-Arbitrage-Durchlauf (nur wenn aktiviert; Default aus).
      if (persistState && env.KLEINANZEIGEN_ENABLED) {
        try {
          alertsPosted += await this.runArbitrageScan(profiles);
        } catch (error) {
          logger.warn({ error }, 'arbitrage scan failed');
        }
      }

      const availabilityRefresh = runAvailabilityCleanup
        ? await this.refreshAvailability()
        : { checkedListings: 0, removedListings: 0, failedChecks: 0 };
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
        availabilityRemovals: availabilityRefresh.removedListings,
      };
    })();

    this.currentRunPromise = runPromise;

    try {
      return await runPromise;
    } finally {
      await this.state.commitBatch();
      this.currentRunPromise = null;
      this.isRunning = false;
    }
  }
}
