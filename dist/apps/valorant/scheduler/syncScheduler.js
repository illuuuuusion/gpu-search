function getNextRunAt(ingestHourUtc, now = new Date()) {
    const next = new Date(now);
    next.setUTCHours(ingestHourUtc, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
}
export class ValorantSyncScheduler {
    repository;
    syncService;
    options;
    timer = null;
    runningPromise = null;
    constructor(repository, syncService, options) {
        this.repository = repository;
        this.syncService = syncService;
        this.options = options;
    }
    async scheduleNextRun() {
        const state = await this.repository.load();
        const nextRunAt = getNextRunAt(this.options.ingestHourUtc);
        state.metadata.nextScheduledSyncAt = nextRunAt.toISOString();
        await this.repository.save(state);
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            void this.runAndReschedule('scheduled');
        }, Math.max(0, nextRunAt.getTime() - Date.now()));
    }
    async runAndReschedule(trigger) {
        if (!this.runningPromise) {
            const previousState = await this.repository.load();
            this.runningPromise = this.syncService.runSync(trigger)
                .then(async (result) => {
                if (this.options.onSyncCompleted) {
                    await this.options.onSyncCompleted(result, previousState);
                }
                return result;
            })
                .finally(() => {
                this.runningPromise = null;
            });
        }
        try {
            return await this.runningPromise;
        }
        finally {
            await this.scheduleNextRun();
        }
    }
    async start() {
        const state = await this.repository.load();
        if (!state.metadata.lastSuccessfulSyncAt) {
            await this.runAndReschedule('startup');
            return;
        }
        await this.scheduleNextRun();
    }
    async triggerManualSync() {
        if (this.runningPromise) {
            return this.runningPromise;
        }
        return this.runAndReschedule('manual');
    }
    async getStatus() {
        return this.repository.getStatusSnapshot(Boolean(this.runningPromise));
    }
    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    setOnSyncCompleted(listener) {
        this.options.onSyncCompleted = listener;
    }
}
