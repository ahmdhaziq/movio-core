import { extractBearerToken } from './extract-bearer-token.js';
describe('Bearer extraction', () => {
  it('accepts one case-insensitive scheme and preserves token', () => {
    expect(
      extractBearerToken({
        headers: { authorization: 'bEaReR abc.def.ghi' },
        rawHeaders: ['Authorization', 'bEaReR abc.def.ghi'],
      }),
    ).toBe('abc.def.ghi');
  });
  it.each([
    undefined,
    '',
    'Basic x',
    'Bearer',
    'Bearer ',
    'Bearer x y',
    `Bearer ${'x'.repeat(4097)}`,
  ])('rejects missing/malformed/oversized bearer', (authorization) => {
    expect(() =>
      extractBearerToken({ headers: { authorization }, rawHeaders: [] }),
    ).toThrow();
  });
  it('rejects duplicate raw fields and never accepts cookies or queries', () => {
    expect(() =>
      extractBearerToken({
        headers: { authorization: 'Bearer x' },
        rawHeaders: ['Authorization', 'Bearer x', 'authorization', 'Bearer y'],
      }),
    ).toThrow();
    expect(() => extractBearerToken({ headers: {}, rawHeaders: [] })).toThrow();
  });
});
