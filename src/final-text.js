export function buildFinalText(finalMessages = [], stdoutChunks = []) {
  const messageText = finalMessages
    .map(message => String(message || '').trim())
    .filter(Boolean)
    .join('\n\n');

  if (messageText) return messageText;

  const rawText = stdoutChunks.join('').trim();
  return rawText || null;
}
