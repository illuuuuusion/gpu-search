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
}
