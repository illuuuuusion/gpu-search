import { evaluateListing } from './filterEngine.js';
import { formatListingMessage } from './messageFormatter.js';
import { selectProfileForListing } from './profileMatcher.js';
import { searchBuckets } from '../config/searchBuckets.js';
import { searchBucketListingsPage } from '../integrations/ebay/client.js';
import type { GpuProfile } from '../types/domain.js';
import type { Notifier } from '../integrations/matrix/notifier.js';
import type { EbayListing } from '../types/domain.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

function isNewerThanCutoff(listing: EbayListing, cutoff: string | undefined): boolean {
  if (!cutoff || !listing.itemOriginDate) return true;
  return listing.itemOriginDate > cutoff;
}

export class ScannerService {
  private seen = new Set<string>();
  private isRunning = false;
  private bucketWatermarks = new Map<string, string>();

  constructor(private readonly notifier: Notifier) {}

  async runOnce(profiles: GpuProfile[]): Promise<void> {
    if (this.isRunning) {
      logger.warn('Skipping scan because previous run is still active');
      return;
    }

    this.isRunning = true;

    try {
      const collectedListings = new Map<string, EbayListing>();

      for (const bucket of searchBuckets) {
        const previousWatermark = this.bucketWatermarks.get(bucket.id);
        const nextWatermark = new Date().toISOString();
        logger.info({
          bucket: bucket.name,
          query: bucket.query,
          previousWatermark,
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

      for (const listing of collectedListings.values()) {
        const match = selectProfileForListing(profiles, listing);
        if (!match) continue;

        const result = evaluateListing(match.profile, listing);
        if (!result.accepted) continue;
        if (this.seen.has(listing.id)) continue;

        try {
          await this.notifier.send(formatListingMessage(result));
          this.seen.add(listing.id);
        } catch (error) {
          logger.error({
            error,
            listingId: listing.id,
            profile: match.profile.name,
            matchedAlias: match.alias,
          }, 'failed to send notification');
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
