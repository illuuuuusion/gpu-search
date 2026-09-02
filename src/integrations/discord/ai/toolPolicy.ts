// Deterministische Tool-Policy AUSSERHALB des Sprachmodells. Sie entscheidet
// allein anhand der Tabelle unten -- nicht anhand von Prompt, Sidecar oder Claude.
export type RiskClass =
  | 'read'
  | 'low-write'
  | 'structural-write'
  | 'moderation'
  | 'destructive'
  | 'external';

// Risikomatrix aus dem Umsetzungsplan (Abschnitt 7). Jedes Tool, das der
// adminToolExecutor kennt, muss hier genau eine Klasse haben.
export const TOOL_RISK_CLASSES: Readonly<Record<string, RiskClass>> = Object.freeze({
  // Phase 2 -- read-only
  get_guild_info: 'read',
  list_channels: 'read',
  view_channel_permissions: 'read',
  list_roles: 'read',
  get_role_permissions: 'read',
  list_members: 'read',
  get_member: 'read',
  get_member_permissions: 'read',
  get_audit_log: 'read',
  list_bans: 'read',
  list_invites: 'read',
  list_webhooks: 'read',
  list_automod_rules: 'read',
  get_messages: 'read',
  // Phase 3 -- reversible Writes, jeweils freigabepflichtig
  send_message: 'low-write',
  set_slowmode: 'low-write',
  lock_channel: 'low-write',
  unlock_channel: 'low-write',
  create_text_channel: 'structural-write',
  create_voice_channel: 'structural-write',
  create_category: 'structural-write',
  modify_channel: 'structural-write',
  reorder_channels: 'structural-write',
  create_role: 'structural-write',
  modify_role: 'structural-write',
  assign_role: 'structural-write',
  remove_role: 'structural-write',
  set_channel_permissions: 'structural-write',
  timeout_member: 'moderation',
  // Phase 4 -- destruktiv, ohne Feature-Flag nicht registrierbar
  delete_channel: 'destructive',
  delete_role: 'destructive',
  kick_member: 'destructive',
  ban_member: 'destructive',
  bulk_ban: 'destructive',
  prune_members: 'destructive',
  bulk_delete_messages: 'destructive',
  purge_user_messages: 'destructive',
  delete_webhook: 'destructive',
  delete_integration: 'destructive',
  edit_server: 'destructive',
  // Exfiltrations-nahe Werkzeuge: in V1 dauerhaft gesperrt
  create_webhook: 'external',
  send_direct_message: 'external',
  download_attachment: 'external',
  fetch_url: 'external',
});

export type PolicyDecision =
  | { allow: true; risk: RiskClass; requiresApproval: boolean }
  | { allow: false; reason: string };

export function classifyTool(toolName: string): RiskClass | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_RISK_CLASSES, toolName)
    ? TOOL_RISK_CLASSES[toolName]
    : undefined;
}

export interface PolicyOptions {
  destructiveToolsEnabled: boolean;
}

// Default-Deny: unbekannte Tools, destruktive Tools ohne Flag und die gesamte
// External-Klasse werden abgelehnt. Alles ausser `read` braucht eine Owner-Freigabe.
export function evaluateTool(toolName: string, options: PolicyOptions): PolicyDecision {
  const risk = classifyTool(toolName);
  if (!risk) {
    return { allow: false, reason: `unknown tool: ${toolName}` };
  }

  if (risk === 'external') {
    return { allow: false, reason: `tool class "external" is disabled in V1: ${toolName}` };
  }

  if (risk === 'destructive' && !options.destructiveToolsEnabled) {
    return { allow: false, reason: `destructive tools are disabled: ${toolName}` };
  }

  return { allow: true, risk, requiresApproval: risk !== 'read' };
}
