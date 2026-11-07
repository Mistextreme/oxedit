import type { FileModel } from './fieldMap';
import { entryKeys, readField } from './editModel';
import { SCHEMAS, resolveImage } from './schemaRegistry';
import type { DataFileName } from '@/services/fileSystem';

export interface MissingItem {
  entryKey: string;
  expectedName: string;
  label: string;
}

/** Entries whose resolved icon filename is not present (or marked removed) in the project images. */
export function findMissingImages(
  file: DataFileName,
  model: FileModel,
  images: Array<{ name: string; removed?: boolean }>
): MissingItem[] {
  const schema = SCHEMAS[file];
  if (!schema.images) return [];
  const present = new Set(images.filter((i) => !i.removed).map((i) => i.name));
  const out: MissingItem[] = [];
  for (const k of entryKeys(model)) {
    const expectedName = resolveImage(file, model, k);
    if (!expectedName || present.has(expectedName)) continue;
    out.push({ entryKey: k, expectedName, label: String(readField(model, k, schema.labelKey) ?? '') });
  }
  return out;
}

export type MatchStatus = 'found' | 'partial' | 'missing';

export interface FolderImageRef {
  name: string;
  path: string;
}

export interface MatchResult<T extends FolderImageRef = FolderImageRef> {
  item: MissingItem;
  status: MatchStatus;
  score: number;
  match?: T;
  candidates: number;
}

export const stripExt = (n: string) => n.replace(/\.[^./]+$/, '');
export const extOf = (n: string) => (/\.([^./]+)$/.exec(n)?.[1] ?? '').toLowerCase();
export const normalizeName = (n: string) => stripExt(n).toLowerCase().replace(/[\s_\-.]+/g, '');

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 100;
  return Math.round((1 - levenshtein(a, b) / max) * 100);
}

const MIN_PARTIAL_LEN = 3;

/**
 * Match each missing item against images found in a folder tree.
 * - 100%: same file name ignoring extension and case (prefers .png, then shortest path).
 * - partial: equal after stripping separators (scored 95), or one name contains the other
 *   (scored by edit-distance similarity). Best score wins, ties go to the shortest name.
 */
export function matchImages<T extends FolderImageRef>(items: MissingItem[], images: T[]): MatchResult<T>[] {
  const byBase = new Map<string, T[]>();
  const byNorm = new Map<string, T[]>();
  const normed = images.map((img) => ({ img, norm: normalizeName(img.name) }));
  for (const { img, norm } of normed) {
    const base = stripExt(img.name).toLowerCase();
    (byBase.get(base) ?? byBase.set(base, []).get(base)!).push(img);
    (byNorm.get(norm) ?? byNorm.set(norm, []).get(norm)!).push(img);
  }
  const rankExact = (a: T, b: T) =>
    Number(extOf(b.name) === 'png') - Number(extOf(a.name) === 'png') || a.path.length - b.path.length;

  return items.map((item) => {
    const base = stripExt(item.expectedName).toLowerCase();
    const exact = byBase.get(base);
    if (exact?.length) {
      const sorted = [...exact].sort(rankExact);
      return { item, status: 'found', score: 100, match: sorted[0], candidates: exact.length };
    }

    const norm = normalizeName(item.expectedName);
    const sameNorm = byNorm.get(norm);
    if (sameNorm?.length) {
      const sorted = [...sameNorm].sort(rankExact);
      return { item, status: 'partial', score: 95, match: sorted[0], candidates: sameNorm.length };
    }

    let best: { img: T; score: number } | undefined;
    let candidates = 0;
    if (norm.length >= MIN_PARTIAL_LEN) {
      for (const { img, norm: n } of normed) {
        if (n.length < MIN_PARTIAL_LEN || !(n.includes(norm) || norm.includes(n))) continue;
        candidates++;
        const score = Math.min(94, similarity(norm, n));
        if (!best || score > best.score || (score === best.score && img.name.length < best.img.name.length)) {
          best = { img, score };
        }
      }
    }
    return best
      ? { item, status: 'partial', score: best.score, match: best.img, candidates }
      : { item, status: 'missing', score: 0, candidates: 0 };
  });
}
