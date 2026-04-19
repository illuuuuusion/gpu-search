export interface AlertField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface AlertMessage {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  color: 'success' | 'danger';
  fields: AlertField[];
}

export interface Notifier {
  start?(): Promise<void>;
  send(message: AlertMessage): Promise<void>;
}

export function renderAlertMessage(message: AlertMessage): string {
  return [
    message.title,
    message.description,
    ...message.fields.map(field => `${field.name}: ${field.value}`),
    message.url,
  ].join('\n');
}

export class ConsoleNotifier implements Notifier {
  async send(message: AlertMessage): Promise<void> {
    console.log('\n--- ALERT ---\n' + renderAlertMessage(message) + '\n--------------\n');
  }
}
