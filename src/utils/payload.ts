/**
 * Utility for capping large payload buffers to prevent memory spikes
 * while logging HTTP request/response bodies.
 */

export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Converts an array of Buffer chunks into a string, truncating with a notice
 * if the total size exceeds `maxSize`.
 */
export function extractBodyString(
  chunks: Buffer[],
  maxSize: number = DEFAULT_MAX_BODY_SIZE
): string {
  if (!chunks || chunks.length === 0) {
    return '';
  }

  let totalLen = 0;
  for (const c of chunks) {
    totalLen += c.length;
  }

  if (totalLen <= maxSize) {
    return Buffer.concat(chunks).toString('utf8');
  }

  let accumulated = 0;
  const keptChunks: Buffer[] = [];
  for (const c of chunks) {
    if (accumulated + c.length <= maxSize) {
      keptChunks.push(c);
      accumulated += c.length;
    } else {
      const remaining = maxSize - accumulated;
      if (remaining > 0) {
        keptChunks.push(c.subarray(0, remaining));
      }
      break;
    }
  }

  const sizeMb = (totalLen / (1024 * 1024)).toFixed(2);
  const maxMb = (maxSize / (1024 * 1024)).toFixed(0);
  return (
    Buffer.concat(keptChunks).toString('utf8') +
    `\n\n[Payload truncated: ${sizeMb} MB exceeded ${maxMb} MB capture limit]`
  );
}
