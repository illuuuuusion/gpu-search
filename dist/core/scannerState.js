import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'data/scanner-state.json');
function getStatePath() {
    return env.SCANNER_STATE_PATH ?? DEFAULT_STATE_PATH;
}
function cutoffTimestamp(days, now = Date.now()) {
    return now - days * 24 * 60 * 60 * 1000;
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
    async recordSent(result) {
        const sentAt = new Date().toISOString();
        this.seen.set(result.listing.id, {
            listingId: result.listing.id,
            profileName: result.profile.name,
            sentAt,
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
    async loadInternal() {
        try {
            const raw = await fs.readFile(getStatePath(), 'utf8');
            const parsed = JSON.parse(raw);
            for (const entry of parsed.seen ?? []) {
                if (entry?.listingId && entry?.sentAt && entry?.profileName) {
                    this.seen.set(entry.listingId, entry);
                }
            }
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
            version: 1,
            updatedAt: new Date().toISOString(),
            seen: Array.from(this.seen.values()).sort((left, right) => left.sentAt.localeCompare(right.sentAt)),
            observations: this.observations.sort((left, right) => left.observedAt.localeCompare(right.observedAt)),
        }, null, 2));
    }
}
