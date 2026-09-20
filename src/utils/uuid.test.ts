import generateUuid, { generateUuid as namedUuid } from './uuid';

describe('UUID Utility (src/utils/uuid.ts)', () => {
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('should generate a string adhering to UUID v4 RFC-4122 format', () => {
    const id = generateUuid();
    expect(typeof id).toBe('string');
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('should have 4 as the version digit', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateUuid();
      expect(id.charAt(14)).toBe('4');
    }
  });

  it('should have 8, 9, a, or b as the variant digit', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateUuid();
      const variant = id.charAt(19).toLowerCase();
      expect(['8', '9', 'a', 'b']).toContain(variant);
    }
  });

  it('should generate unique values across multiple invocations', () => {
    const count = 1000;
    const set = new Set<string>();
    for (let i = 0; i < count; i++) {
      set.add(generateUuid());
    }
    expect(set.size).toBe(count);
  });

  it('should provide named export and .v4 property', () => {
    expect(namedUuid).toBe(generateUuid);
    expect(generateUuid.v4).toBe(generateUuid);
    expect(generateUuid.v4()).toMatch(UUID_V4_REGEX);
  });
});
