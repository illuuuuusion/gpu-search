export function renderAlertMessage(message) {
    return [
        message.title,
        message.description,
        ...message.fields.map(field => `${field.name}: ${field.value}`),
        message.url,
    ].join('\n');
}
export class ConsoleNotifier {
    async send(message) {
        console.log('\n--- ALERT ---\n' + renderAlertMessage(message) + '\n--------------\n');
    }
    async sendScanStatus(message) {
        const summary = message.summary
            ? ` alerts=${message.summary.alertsPosted} accepted=${message.summary.acceptedListings} unique=${message.summary.uniqueListings}`
            : '';
        console.log(`[scan-status] trigger=${message.trigger} phase=${message.phase}${summary}`);
    }
    async sendValorantSyncStatus(message) {
        console.log(`[valorant-sync] trigger=${message.trigger} provider=${message.provider} health=${message.healthState} events=${message.importedEvents} comps=${message.parsedCompositions} full_comps=${message.aggregatedFullComps} meta=${message.metaChanges.join(' | ')}`);
    }
    async sendMarketDigest(message) {
        const topProfiles = message.topProfiles
            .map(profile => `${profile.profileName}(${profile.acceptedCount}, avg=${profile.averageTotalPriceEur?.toFixed(2) ?? 'n/a'}€)`)
            .join(' | ');
        console.log(`[market-digest] cadence=${message.cadence} accepted=${message.totalAcceptedListings} working=${message.totalWorkingListings} defect=${message.totalDefectListings} snapshot=${message.snapshotPath} top=${topProfiles}`);
    }
    async delete() {
        // Console alerts are ephemeral; nothing to delete.
    }
    async markUnavailable(receipt, details) {
        console.log(`[listing-expired] messageId=${receipt.messageId ?? 'n/a'} checkedAt=${details.checkedAt} reason=${details.reason}`);
    }
}
