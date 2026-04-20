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
    async delete() {
        // Console alerts are ephemeral; nothing to delete.
    }
}
