// Werkzeuge, die der Sidecar Claude anbietet. Sie fuehren nichts selbst aus,
// sondern reichen Toolname, fachliche Argumente und die vom Hauptprozess
// ausgestellte requestId ueber den Unix-Socket zurueck. Absender, Guild und
// Kanal kennt nur gpu-search.
export const TOOL_DEFINITIONS = [
  { name: 'reply', description: 'Antwortet im Ursprungskanal der Anfrage.', input: ['requestId', 'content'] },
  { name: 'react', description: 'Setzt eine Reaction auf die Ursprungsnachricht.', input: ['requestId', 'emoji', 'messageId?'] },
  { name: 'edit_message', description: 'Bearbeitet eine eigene Bot-Nachricht.', input: ['requestId', 'messageId', 'content'] },
  { name: 'admin_tool_request', description: 'Fordert ein Discord-Admin-Tool an; Policy und Freigabe entscheidet gpu-search.', input: ['requestId', 'toolName', 'args?', 'approvalId?'] },
  { name: 'health', description: 'Fragt den Zustand von gpu-search und der Discord-Verbindung ab.', input: [] },
];

export function createToolHandlers(socketClient) {
  return {
    reply: args => socketClient.request('reply', { requestId: args.requestId, content: args.content }),
    react: args => socketClient.request('react', { requestId: args.requestId, emoji: args.emoji, messageId: args.messageId }),
    edit_message: args => socketClient.request('edit_message', {
      requestId: args.requestId, messageId: args.messageId, content: args.content,
    }),
    admin_tool_request: args => socketClient.request('admin_tool_request', {
      requestId: args.requestId, toolName: args.toolName, args: args.args ?? {}, approvalId: args.approvalId,
    }),
    health: () => socketClient.request('health'),
  };
}
