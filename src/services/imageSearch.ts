import { isSupported, promptFolderUpload, type FsDirHandle, type FsFileHandle } from './fileSystem';
import { downloadBlob } from './zipExport';
import { extOf } from '@/engine/missingImages';
import type { MissingItem } from '@/engine/missingImages';

export interface FolderImage {
  name: string;
  path: string;
  file: File;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

async function walk(dir: FsDirHandle, prefix: string, out: FolderImage[], onProgress?: (n: number) => void) {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await walk(entry, path, out, onProgress);
    } else if (IMAGE_RE.test(entry.name)) {
      out.push({ name: entry.name, path, file: await (entry as FsFileHandle).getFile() });
      if (out.length % 50 === 0) onProgress?.(out.length);
    }
  }
}

/**
 * Let the user pick any folder and collect every image in it, including subfolders.
 * Uses a read-only directory picker (does not replace the opened ox_inventory folder),
 * falling back to a directory upload on browsers without the File System Access API.
 * Returns null if the user cancels.
 */
export async function pickImageFolder(
  onProgress?: (n: number) => void
): Promise<{ folderName: string; images: FolderImage[] } | null> {
  if (isSupported()) {
    let dir: FsDirHandle;
    try {
      dir = await (window as any).showDirectoryPicker({ mode: 'read', id: 'oxedit-image-search' });
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
    const images: FolderImage[] = [];
    await walk(dir, '', images, onProgress);
    return { folderName: dir.name, images };
  }

  const files = await promptFolderUpload();
  if (files.length === 0) return null;
  const rel = (f: File) => ((f as any).webkitRelativePath as string) || f.name;
  const images = files
    .filter((f) => IMAGE_RE.test(f.name))
    .map((f) => ({ name: f.name, path: rel(f), file: f }));
  return { folderName: rel(files[0]).split('/')[0] || 'folder', images };
}

async function convertToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG conversion failed'))), 'image/png')
  );
}

/** Produce a File named exactly as ox_inventory expects, converting the format when the extension differs. */
export async function prepareForImport(source: File, expectedName: string): Promise<File> {
  const want = extOf(expectedName);
  const have = extOf(source.name);
  const sameFormat = want === have || (['jpg', 'jpeg'].includes(want) && ['jpg', 'jpeg'].includes(have));
  if (sameFormat || want !== 'png') return new File([source], expectedName, { type: source.type });
  const png = await convertToPng(source);
  return new File([png], expectedName, { type: 'image/png' });
}

export interface MissingExportRow extends MissingItem {
  status?: string;
  score?: number;
  suggestion?: string;
}

export function missingAsText(rows: MissingExportRow[]): string {
  return rows.map((r) => r.expectedName).join('\n');
}

export function exportMissing(rows: MissingExportRow[], format: 'json' | 'csv', file: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const data = rows.map(({ entryKey, label, expectedName, status, score, suggestion }) => ({
      item: entryKey,
      label,
      image: expectedName,
      ...(status ? { status, score, suggestion } : {}),
    }));
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `missing-${file}-${stamp}.json`);
    return;
  }
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['item', 'label', 'image', 'status', 'score', 'suggestion'];
  const lines = rows.map((r) =>
    [r.entryKey, r.label, r.expectedName, r.status ?? 'missing', r.score ?? '', r.suggestion ?? ''].map(esc).join(',')
  );
  downloadBlob(new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' }), `missing-${file}-${stamp}.csv`);
}
