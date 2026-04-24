import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'data/scanner-state.json');
const DEFAULT_MARKET_SUMMARY_PATH = path.resolve(process.cwd(), 'data/market-summary.json');
function getStatePath() {
    return env.SCANNER_STATE_PATH ?? DEFAULT_STATE_PATH;
}
function getMarketSummaryPath() {
    return env.MARKET_SUMMARY_PATH ?? DEFAULT_MARKET_SUMMARY_PATH;
}
function cutoffTimestamp(days, now = Date.now()) {
    return now - days * 24 * 60 * 60 * 1000;
}
function round(value) {
    return Number(value.toFixed(2));
}
function startOfUtcDay(input) {
    const value = new Date(input);
    value.setUTCHours(0, 0, 0, 0);
    return value;
}
function startOfUtcWeek(input) {
    const value = startOfUtcDay(input);
    const day = value.getUTCDay();
    const offset = (day + 6) % 7;
    value.setUTCDate(value.getUTCDate() - offset);
    return value;
}
function addDays(input, days) {
    const value = new Date(input);
    value.setUTCDate(value.getUTCDate() + days);
    return value;
}
function bucketStartForDate(input, mode) {
    return mode === 'weekly' ? startOfUtcWeek(input) : startOfUtcDay(input);
}
function bucketEndForDate(input, mode) {
    return mode === 'weekly'
        ? addDays(bucketStartForDate(input, mode), 7)
        : addDays(bucketStartForDate(input, mode), 1);
}
function formatBucketLabel(input, mode) {
    if (mode === 'weekly') {
        const end = addDays(input, 6);
        return `${input.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`;
    }
    return input.toISOString().slice(0, 10);
}
function summarizeChartPoints(observations, mode) {
    const buckets = new Map();
    for (const observation of observations) {
        const bucketStart = bucketStartForDate(new Date(observation.observedAt), mode).toISOString();
        const existing = buckets.get(bucketStart);
        if (existing) {
            existing.push(observation);
        }
        else {
            buckets.set(bucketStart, [observation]);
        }
    }
    return Array.from(buckets.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([bucketStartIso, bucketObservations]) => {
        const working = bucketObservations.filter(observation => observation.health === 'WORKING');
        const defect = bucketObservations.filter(observation => observation.health === 'DEFECT');
        const totalPrices = bucketObservations.map(observation => observation.totalEur);
        const scoreSum = bucketObservations.reduce((sum, observation) => sum + observation.score, 0);
        const bucketStart = new Date(bucketStartIso);
        return {
            bucketStart: bucketStartIso,
            bucketEnd: bucketEndForDate(bucketStart, mode).toISOString(),
            label: formatBucketLabel(bucketStart, mode),
            acceptedCount: bucketObservations.length,
            workingCount: working.length,
            defectCount: defect.length,
            averageTotalPriceEur: bucketObservations.length > 0
                ? round(totalPrices.reduce((sum, value) => sum + value, 0) / bucketObservations.length)
                : undefined,
            averageWorkingPriceEur: working.length > 0
                ? round(working.reduce((sum, observation) => sum + observation.totalEur, 0) / working.length)
                : undefined,
            averageDefectPriceEur: defect.length > 0
                ? round(defect.reduce((sum, observation) => sum + observation.totalEur, 0) / defect.length)
                : undefined,
            averageScore: bucketObservations.length > 0 ? round(scoreSum / bucketObservations.length) : 0,
            minTotalPriceEur: totalPrices.length > 0 ? round(Math.min(...totalPrices)) : undefined,
            maxTotalPriceEur: totalPrices.length > 0 ? round(Math.max(...totalPrices)) : undefined,
        };
    });
}
function buildBarDatum(profileName, value) {
    if (value === undefined || !Number.isFinite(value)) {
        return null;
    }
    return {
        key: profileName,
        label: profileName,
        value: round(value),
    };
}
function summarizeObservations(profileName, observations) {
    const acceptedCount = observations.length;
    const scoreSum = observations.reduce((sum, observation) => sum + observation.score, 0);
    const workingObservations = observations.filter(observation => observation.health === 'WORKING');
    const defectObservations = observations.filter(observation => observation.health === 'DEFECT');
    const workingSum = workingObservations.reduce((sum, observation) => sum + observation.totalEur, 0);
    const defectSum = defectObservations.reduce((sum, observation) => sum + observation.totalEur, 0);
    const lastObservedAt = observations
        .map(observation => observation.observedAt)
        .sort()
        .at(-1);
    return {
        profileName,
        windowDays: env.SCANNER_STATS_WINDOW_DAYS,
        acceptedCount,
        averageScore: acceptedCount > 0 ? Number((scoreSum / acceptedCount).toFixed(2)) : 0,
        workingCount: workingObservations.length,
        averageWorkingPriceEur: workingObservations.length > 0
            ? Number((workingSum / workingObservations.length).toFixed(2))
            : undefined,
        defectCount: defectObservations.length,
        averageDefectPriceEur: defectObservations.length > 0
            ? Number((defectSum / defectObservations.length).toFixed(2))
            : undefined,
        lastObservedAt,
    };
}
export class ScannerStateStore {
    seen = new Map();
    observations = [];
    metadata = {};
    loadPromise = null;
    async load() {
        if (!this.loadPromise) {
            this.loadPromise = this.loadInternal();
        }
        await this.loadPromise;
    }
    hasSeen(listingId) {
        return this.seen.has(listingId);
    }
    previewStats(result) {
        const profileObservations = this.getWindowedObservations(result.profile.name);
        const previewObservation = this.toObservation(result, new Date().toISOString());
        return summarizeObservations(result.profile.name, [
            ...profileObservations.filter(observation => observation.listingId !== result.listing.id),
            previewObservation,
        ]);
    }
    getListingsDueForAvailabilityCheck(referenceTime = Date.now()) {
        const cutoff = cutoffTimestamp(env.SCANNER_AVAILABILITY_RECHECK_HOURS / 24, referenceTime);
        return Array.from(this.seen.values())
            .filter(record => {
            const lastCheck = record.lastAvailabilityCheckAt ?? record.sentAt;
            return new Date(lastCheck).getTime() <= cutoff;
        })
            .sort((left, right) => {
            const leftTime = left.lastAvailabilityCheckAt ?? left.sentAt;
            const rightTime = right.lastAvailabilityCheckAt ?? right.sentAt;
            return leftTime.localeCompare(rightTime);
        })
            .slice(0, env.SCANNER_AVAILABILITY_CHECK_BATCH_SIZE);
    }
    async recordSent(result, receipt) {
        const sentAt = new Date().toISOString();
        this.seen.set(result.listing.id, {
            listingId: result.listing.id,
            profileName: result.profile.name,
            sentAt,
            notificationMessageId: receipt?.messageId,
            notificationChannelId: receipt?.channelId,
            lastAvailabilityCheckAt: sentAt,
        });
        this.observations = [
            ...this.observations.filter(observation => observation.listingId !== result.listing.id),
            this.toObservation(result, sentAt),
        ];
        this.prune(sentAt);
        try {
            await this.persist();
        }
        catch (error) {
            logger.warn({ error, listingId: result.listing.id }, 'Failed to persist scanner state');
        }
    }
    async recordObservation(result) {
        const observedAt = new Date().toISOString();
        this.observations = [
            ...this.observations.filter(observation => observation.listingId !== result.listing.id),
            this.toObservation(result, observedAt),
        ];
        this.prune(observedAt);
        try {
            await this.persist();
        }
        catch (error) {
            logger.warn({ error, listingId: result.listing.id }, 'Failed to persist scanner observation');
        }
    }
    async recordAvailabilityCheck(listingId, checkedAt) {
        const existing = this.seen.get(listingId);
        if (!existing) {
            return;
        }
        this.seen.set(listingId, {
            ...existing,
            lastAvailabilityCheckAt: checkedAt,
        });
        try {
            await this.persist();
        }
        catch (error) {
            logger.warn({ error, listingId }, 'Failed to persist scanner availability check');
        }
    }
    async reset() {
        const result = {
            seenCount: this.seen.size,
            observationCount: this.observations.length,
        };
        this.seen.clear();
        this.observations = [];
        this.metadata = {};
        try {
            await this.persist();
        }
        catch (error) {
            logger.warn({ error }, 'Failed to persist scanner state reset');
        }
        return result;
    }
    async forgetSeen(listingId) {
        if (!this.seen.delete(listingId)) {
            return;
        }
        try {
            await this.persist();
        }
        catch (error) {
            logger.warn({ error, listingId }, 'Failed to persist scanner seen removal');
        }
    }
    shouldSendDigest(cadence, referenceTime = new Date().toISOString()) {
        const lastSentAt = cadence === 'daily'
            ? this.metadata.lastDailyDigestAt
            : this.metadata.lastWeeklyDigestAt;
        if (!lastSentAt) {
            return true;
        }
        const currentBucket = bucketStartForDate(new Date(referenceTime), cadence).toISOString();
        const lastBucket = bucketStartForDate(new Date(lastSentAt), cadence).toISOString();
        return currentBucket > lastBucket;
    }
    async markDigestSent(cadence, sentAt = new Date().toISOString()) {
        if (cadence === 'daily') {
            this.metadata.lastDailyDigestAt = sentAt;
        }
        else {
            this.metadata.lastWeeklyDigestAt = sentAt;
        }
        try {
            await this.persist();
        }
        catch (error) {
            logger.warn({ error, cadence }, 'Failed to persist scanner digest timestamp');
        }
    }
    buildMarketDashboardSnapshot(profiles, generatedAt = new Date().toISOString()) {
        const profileSnapshots = profiles
            .map(profile => {
            const observations = this.getWindowedObservations(profile.name, new Date(generatedAt).getTime());
            const stats = summarizeObservations(profile.name, observations);
            return {
                ...stats,
                category: profile.category,
                targetHealth: profile.targetHealth ?? 'ANY',
                charts: {
                    daily: summarizeChartPoints(observations, 'daily'),
                    weekly: summarizeChartPoints(observations, 'weekly'),
                },
            };
        })
            .filter(profile => profile.acceptedCount > 0)
            .sort((left, right) => right.acceptedCount - left.acceptedCount || left.profileName.localeCompare(right.profileName));
        const acceptedCountByProfile = profileSnapshots
            .map(profile => buildBarDatum(profile.profileName, profile.acceptedCount))
            .filter((value) => Boolean(value));
        const averageWorkingPriceByProfile = profileSnapshots
            .map(profile => buildBarDatum(profile.profileName, profile.averageWorkingPriceEur))
            .filter((value) => Boolean(value));
        const averageDefectPriceByProfile = profileSnapshots
            .map(profile => buildBarDatum(profile.profileName, profile.averageDefectPriceEur))
            .filter((value) => Boolean(value));
        const averageScoreByProfile = profileSnapshots
            .map(profile => buildBarDatum(profile.profileName, profile.averageScore))
            .filter((value) => Boolean(value));
        return {
            generatedAt,
            windowDays: env.SCANNER_STATS_WINDOW_DAYS,
            snapshotPath: getMarketSummaryPath(),
            profiles: profileSnapshots,
            barCharts: {
                acceptedCountByProfile,
                averageWorkingPriceByProfile,
                averageDefectPriceByProfile,
                averageScoreByProfile,
            },
        };
    }
    buildMarketDigest(profiles, cadence, generatedAt = new Date().toISOString()) {
        const periodEndDate = new Date(generatedAt);
        const periodStartDate = cadence === 'weekly'
            ? addDays(startOfUtcDay(periodEndDate), -6)
            : startOfUtcDay(periodEndDate);
        const periodStart = periodStartDate.toISOString();
        const periodEnd = periodEndDate.toISOString();
        const periodObservations = this.observations.filter(observation => {
            const observedAt = new Date(observation.observedAt).getTime();
            return observedAt >= periodStartDate.getTime() && observedAt <= periodEndDate.getTime();
        });
        const topProfiles = [];
        for (const profile of profiles) {
            const observations = periodObservations.filter(observation => observation.profileName === profile.name);
            if (observations.length === 0) {
                continue;
            }
            const working = observations.filter(observation => observation.health === 'WORKING');
            const defect = observations.filter(observation => observation.health === 'DEFECT');
            const averageTotalPriceEur = round(observations.reduce((sum, observation) => sum + observation.totalEur, 0) / observations.length);
            const averageScore = round(observations.reduce((sum, observation) => sum + observation.score, 0) / observations.length);
            topProfiles.push({
                profileName: profile.name,
                category: profile.category,
                acceptedCount: observations.length,
                workingCount: working.length,
                defectCount: defect.length,
                averageTotalPriceEur,
                averageScore,
            });
        }
        topProfiles
            .sort((left, right) => right.acceptedCount - left.acceptedCount || right.averageScore - left.averageScore)
            .splice(5);
        return {
            cadence,
            generatedAt,
            periodStart,
            periodEnd,
            totalAcceptedListings: periodObservations.length,
            totalWorkingListings: periodObservations.filter(observation => observation.health === 'WORKING').length,
            totalDefectListings: periodObservations.filter(observation => observation.health === 'DEFECT').length,
            snapshotPath: getMarketSummaryPath(),
            topProfiles,
        };
    }
    async persistMarketDashboardSnapshot(profiles, generatedAt = new Date().toISOString()) {
        const snapshot = this.buildMarketDashboardSnapshot(profiles, generatedAt);
        const snapshotPath = getMarketSummaryPath();
        await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
        await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
        return snapshot;
    }
    async loadInternal() {
        try {
            const raw = await fs.readFile(getStatePath(), 'utf8');
            const parsed = JSON.parse(raw);
            for (const entry of parsed.seen ?? []) {
                if (entry?.listingId && entry?.sentAt && entry?.profileName) {
                    this.seen.set(entry.listingId, entry);
                }
            }
            this.metadata = {
                lastDailyDigestAt: parsed.metadata?.lastDailyDigestAt,
                lastWeeklyDigestAt: parsed.metadata?.lastWeeklyDigestAt,
            };
            this.observations = (parsed.observations ?? []).filter((entry) => Boolean(entry?.listingId &&
                entry?.profileName &&
                entry?.observedAt &&
                typeof entry.totalEur === 'number' &&
                typeof entry.score === 'number' &&
                (entry.health === 'WORKING' || entry.health === 'DEFECT')));
            this.prune();
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT') {
                logger.warn({ error }, 'Failed to load scanner state');
            }
        }
    }
    getWindowedObservations(profileName, referenceTime = Date.now()) {
        const cutoff = cutoffTimestamp(env.SCANNER_STATS_WINDOW_DAYS, referenceTime);
        return this.observations.filter(observation => observation.profileName === profileName &&
            new Date(observation.observedAt).getTime() >= cutoff);
    }
    prune(referenceTime = new Date().toISOString()) {
        const referenceTimestamp = new Date(referenceTime).getTime();
        const seenCutoff = cutoffTimestamp(env.SCANNER_SEEN_RETENTION_DAYS, referenceTimestamp);
        const observationCutoff = cutoffTimestamp(env.SCANNER_STATS_WINDOW_DAYS, referenceTimestamp);
        for (const [listingId, seenRecord] of this.seen.entries()) {
            if (new Date(seenRecord.sentAt).getTime() < seenCutoff) {
                this.seen.delete(listingId);
            }
        }
        this.observations = this.observations.filter(observation => new Date(observation.observedAt).getTime() >= observationCutoff);
    }
    toObservation(result, observedAt) {
        return {
            listingId: result.listing.id,
            profileName: result.profile.name,
            category: result.profile.category,
            targetHealth: result.profile.targetHealth ?? 'ANY',
            observedAt,
            totalEur: result.listing.totalEur,
            score: result.score,
            health: result.health === 'DEFECT' ? 'DEFECT' : 'WORKING',
            offerType: result.listing.buyingOptions.includes('FIXED_PRICE') ? 'FIXED_PRICE' : 'AUCTION',
        };
    }
    async persist() {
        const statePath = getStatePath();
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        await fs.writeFile(statePath, JSON.stringify({
            version: 3,
            updatedAt: new Date().toISOString(),
            metadata: this.metadata,
            seen: Array.from(this.seen.values()).sort((left, right) => left.sentAt.localeCompare(right.sentAt)),
            observations: this.observations.sort((left, right) => left.observedAt.localeCompare(right.observedAt)),
        }, null, 2));
    }
}
