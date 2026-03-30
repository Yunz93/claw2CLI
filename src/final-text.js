export function buildFinalText(finalMessages = [], stdoutChunks = [], stderrChunks = []) {
  const messageText = finalMessages
    .map(message => String(message || '').trim())
    .filter(Boolean)
    .join('\n\n');

  if (messageText) return messageText;

  const rawText = stdoutChunks.join('').trim();
  if (rawText) return rawText;

  const errorText = stderrChunks.join('').trim();
  return errorText || null;
}
