// Werkzeuge, die der Sidecar Claude anbietet. Sie fuehren nichts selbst aus,
// sondern reichen Toolname, fachliche Argumente und die vom Hauptprozess
// ausgestellte requestId ueber den Unix-Socket zurueck. Absender, Guild und
// Kanal kennt nur gpu-search.
export const CHANNEL_TOOLS = [
  { name: 'reply', description: 'Antwortet im Ursprungskanal der Anfrage.', args: ['requestId', 'content'] },
  { name: 'react', description: 'Setzt eine Reaction auf die Ursprungsnachricht.', args: ['requestId', 'emoji', 'messageId?'] },
  { name: 'edit_message', description: 'Bearbeitet eine eigene Bot-Nachricht.', args: ['requestId', 'messageId', 'content'] },
  { name: 'health', description: 'Fragt den Zustand von gpu-search und der Discord-Verbindung ab.', args: [] },
];

export function createToolHandlers(socketClient) {
  return {
    reply: args => socketClient.request('reply', { requestId: args.requestId, content: args.content }),
    react: args => socketClient.request('react', { requestId: args.requestId, emoji: args.emoji, messageId: args.messageId }),
    edit_message: args => socketClient.request('edit_message', {
      requestId: args.requestId, messageId: args.messageId, content: args.content,
    }),
    health: () => socketClient.request('health'),
  };
}

// Admin-Tools werden einzeln angeboten, damit die Claude-Code-Permissions pro
// Werkzeug greifen koennen. Der Katalog kommt vom Hauptprozess -- der Sidecar
// fuehrt bewusst keine eigene Liste, die auseinanderlaufen koennte.
export async function fetchAdminTools(socketClient) {
  const catalog = await socketClient.request('list_tools');
  return (catalog ?? []).map(entry => ({
    name: entry.name,
    description: `${entry.risk}${entry.requiresApproval ? ', freigabepflichtig' : ''}`,
    args: ['requestId', ...entry.args],
  }));
}

export function createAdminToolHandlers(socketClient, adminTools) {
  return Object.fromEntries(adminTools.map(tool => [
    tool.name,
    ({ requestId, approvalId, ...args }) => socketClient.request('admin_tool_request', {
      requestId, approvalId, toolName: tool.name, args,
    }),
  ]));
}
