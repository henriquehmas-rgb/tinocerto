import { encodeCursor, decodeCursor } from '../cursor-pagination';
import { PlatformApiProblem } from '../platform-api-problem';

describe('cursor pagination helper', () => {
  it('encode/decode faz round-trip', () => {
    const cursor = { sortValue: '2026-08-07T12:00:00.000Z', id: '11111111-1111-1111-1111-111111111111' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('cursor não-base64url válido lança PlatformApiProblem 422', () => {
    expect(() => decodeCursor('###não é base64url###')).toThrow(PlatformApiProblem);
  });

  it('cursor decodificável mas sem os campos certos lança PlatformApiProblem 422', () => {
    const bogus = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
    expect(() => decodeCursor(bogus)).toThrow(PlatformApiProblem);
  });
});
