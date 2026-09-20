import { extractBodyString, DEFAULT_MAX_BODY_SIZE } from './payload';

describe('Payload Utility (src/utils/payload.ts)', () => {
  it('should return empty string for empty chunks', () => {
    expect(extractBodyString([])).toBe('');
  });

  it('should return full string when within limit', () => {
    const chunks = [Buffer.from('Hello, '), Buffer.from('World!')];
    expect(extractBodyString(chunks)).toBe('Hello, World!');
  });

  it('should truncate payload and add notice when exceeding maxSize', () => {
    const chunk1 = Buffer.from('12345');
    const chunk2 = Buffer.from('67890');
    // Set limit to 6 bytes
    const result = extractBodyString([chunk1, chunk2], 6);
    expect(result).toContain('123456');
    expect(result).toContain('[Payload truncated:');
  });
});
