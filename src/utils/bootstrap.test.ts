import util from 'util';
import isBootstrapped from './bootstrap';

describe('Bootstrap Utility (src/utils/bootstrap.ts)', () => {
  it('should export true indicating bootstrap completed', () => {
    expect(isBootstrapped).toBe(true);
  });

  it('should patch util._extend to behave like Object.assign', () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    const result = (util as unknown as { _extend: (t: object, s: object) => object })._extend(target, source);

    expect(result).toBe(target);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should handle null or undefined target gracefully', () => {
    const extend = (util as unknown as { _extend: (t: unknown, s: unknown) => object })._extend;
    const result1 = extend(null, { a: 1 });
    expect(result1).toEqual({ a: 1 });

    const result2 = extend({ a: 1 }, null);
    expect(result2).toEqual({ a: 1 });
  });
});
