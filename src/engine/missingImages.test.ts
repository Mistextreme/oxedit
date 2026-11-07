import { describe, expect, it } from 'vitest';
import { matchImages, normalizeName, type MissingItem } from './missingImages';

const item = (name: string): MissingItem => ({ entryKey: name, expectedName: `${name}.png`, label: name });
const img = (path: string) => ({ path, name: path.split('/').pop()! });

describe('matchImages', () => {
  it('finds exact matches across extensions and prefers png', () => {
    const [r] = matchImages([item('water')], [img('a/b/water.jpg'), img('deep/x/water.png')]);
    expect(r.status).toBe('found');
    expect(r.score).toBe(100);
    expect(r.match?.path).toBe('deep/x/water.png');
    expect(r.candidates).toBe(2);
  });

  it('is case-insensitive for exact matches', () => {
    const [r] = matchImages([item('WEAPON_PISTOL')], [img('weapons/weapon_pistol.webp')]);
    expect(r.status).toBe('found');
  });

  it('scores separator-only differences as partial', () => {
    const [r] = matchImages([item('phone_case')], [img('phone-case.png')]);
    expect(r.status).toBe('partial');
    expect(r.score).toBe(95);
  });

  it('uses containment with similarity and prefers the closest name', () => {
    const [r] = matchImages([item('burger')], [img('burger_deluxe_large.png'), img('burgers.png')]);
    expect(r.status).toBe('partial');
    expect(r.match?.name).toBe('burgers.png');
    expect(r.score).toBeGreaterThan(50);
    expect(r.score).toBeLessThan(95);
  });

  it('reports missing when nothing matches', () => {
    const [r] = matchImages([item('lockpick')], [img('water.png')]);
    expect(r.status).toBe('missing');
    expect(r.match).toBeUndefined();
  });

  it('normalizes names', () => {
    expect(normalizeName('My Item-Name_v2.PNG')).toBe('myitemnamev2');
  });
});
