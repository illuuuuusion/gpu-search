import type { MarketDigestMessage } from '../types/domain.js';

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

export interface NotificationReceipt {
  messageId?: string;
  channelId?: string;
}

export interface ScanStatusSummary {
  uniqueListings: number;
  acceptedListings: number;
  seenSkipped: number;
  alertsPosted: number;
  notificationFailures: number;
  availabilityRemovals: number;
}

export interface ScanStatusMessage {
  phase: 'started' | 'finished';
  trigger: 'automatic' | 'manual' | 'force' | 'debug' | 'startup';
  nextAutomaticScanAt?: string;
  summary?: ScanStatusSummary;
}

export interface ValorantSyncStatusMessage {
  trigger: 'startup' | 'scheduled' | 'manual';
  provider: string;
  healthState: 'healthy' | 'degraded';
  healthReasons: string[];
  importedEvents: number;
  parsedCompositions: number;
  aggregatedFullComps: number;
  lastSuccessfulSyncAt?: string;
  metaChanges: string[];
}

export interface Notifier {
  start?(): Promise<void>;
  send(message: AlertMessage): Promise<NotificationReceipt | void>;
  sendScanStatus?(message: ScanStatusMessage): Promise<void>;
  sendValorantSyncStatus?(message: ValorantSyncStatusMessage): Promise<void>;
  sendMarketDigest?(message: MarketDigestMessage): Promise<void>;
  delete?(receipt: NotificationReceipt): Promise<void>;
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

  async sendScanStatus(message: ScanStatusMessage): Promise<void> {
    const summary = message.summary
      ? ` alerts=${message.summary.alertsPosted} accepted=${message.summary.acceptedListings} unique=${message.summary.uniqueListings}`
      : '';
    console.log(`[scan-status] trigger=${message.trigger} phase=${message.phase}${summary}`);
  }

  async sendValorantSyncStatus(message: ValorantSyncStatusMessage): Promise<void> {
    console.log(
      `[valorant-sync] trigger=${message.trigger} provider=${message.provider} health=${message.healthState} events=${message.importedEvents} comps=${message.parsedCompositions} full_comps=${message.aggregatedFullComps} meta=${message.metaChanges.join(' | ')}`,
    );
  }

  async sendMarketDigest(message: MarketDigestMessage): Promise<void> {
    const topProfiles = message.topProfiles
      .map(profile => `${profile.profileName}(${profile.acceptedCount}, avg=${profile.averageTotalPriceEur?.toFixed(2) ?? 'n/a'}€)`)
      .join(' | ');
    console.log(
      `[market-digest] cadence=${message.cadence} accepted=${message.totalAcceptedListings} working=${message.totalWorkingListings} defect=${message.totalDefectListings} snapshot=${message.snapshotPath} top=${topProfiles}`,
    );
  }

  async delete(): Promise<void> {
    // Console alerts are ephemeral; nothing to delete.
  }
}
