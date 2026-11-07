import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, FileJson, FileSpreadsheet, FolderSearch, ImageOff, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useApp } from '@/stores/appStore';
import { matchImages, type MatchResult, type MatchStatus, type MissingItem } from '@/engine/missingImages';
import { exportMissing, pickImageFolder, prepareForImport, type FolderImage } from '@/services/imageSearch';
import * as db from '@/services/db';
import type { DataFileName } from '@/services/fileSystem';
import { cn } from '@/lib/utils';

type Tab = 'all' | MatchStatus;

const STATUS_STYLE: Record<MatchStatus, { card: string; badge: string; label: string }> = {
  found: { card: 'border-emerald-500/40 bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-400', label: 'Found' },
  partial: { card: 'border-amber-500/40 bg-amber-500/5', badge: 'bg-amber-500/15 text-amber-400', label: 'Partial' },
  missing: { card: 'border-destructive/40 bg-destructive/5', badge: 'bg-destructive/15 text-destructive', label: 'Missing' },
};

export function MissingImagesModal({
  file,
  items,
  onClose,
}: {
  file: DataFileName;
  items: MissingItem[];
  onClose: () => void;
}) {
  const addImages = useApp((s) => s.addImages);
  const refreshLogs = useApp((s) => s.refreshLogs);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [folder, setFolder] = useState<{ name: string; count: number } | null>(null);
  const [results, setResults] = useState<MatchResult<FolderImage>[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('all');
  const [importing, setImporting] = useState(false);

  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of results ?? []) if (r.match) m.set(r.item.entryKey, URL.createObjectURL(r.match.file));
    return m;
  }, [results]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const counts = useMemo(() => {
    const c = { all: results?.length ?? 0, found: 0, partial: 0, missing: 0 };
    for (const r of results ?? []) c[r.status]++;
    return c;
  }, [results]);

  const visible = useMemo(
    () => (results ?? []).filter((r) => tab === 'all' || r.status === tab),
    [results, tab]
  );

  const search = async () => {
    setScanning(true);
    setScanned(0);
    try {
      const picked = await pickImageFolder(setScanned);
      if (!picked) return;
      const res = matchImages(items, picked.images);
      setFolder({ name: picked.folderName, count: picked.images.length });
      setResults(res);
      setSelected(new Set(res.filter((r) => r.status === 'found').map((r) => r.item.entryKey)));
      setTab('all');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not read that folder');
    } finally {
      setScanning(false);
    }
  };

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const selectWhere = (pred: (r: MatchResult<FolderImage>) => boolean) =>
    setSelected(new Set((results ?? []).filter((r) => r.match && pred(r)).map((r) => r.item.entryKey)));

  const importSelected = async () => {
    const chosen = (results ?? []).filter((r) => r.match && selected.has(r.item.entryKey));
    if (chosen.length === 0) return;
    setImporting(true);
    try {
      const files = await Promise.all(chosen.map((r) => prepareForImport(r.match!.file, r.item.expectedName)));
      const n = addImages(files);
      await db.addLog({
        ts: Date.now(),
        file,
        entry: `${n} images`,
        action: 'add',
        detail: `imported from folder "${folder?.name ?? '?'}"`,
      });
      await refreshLogs();
      toast.success(`Imported ${n} image${n === 1 ? '' : 's'}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const exportUnmatched = (format: 'json' | 'csv') => {
    const rows = results
      ? results
          .filter((r) => r.status !== 'found' || !selected.has(r.item.entryKey))
          .map((r) => ({ ...r.item, status: r.status, score: r.score, suggestion: r.match?.path }))
      : items;
    if (rows.length === 0) return toast('Nothing left to export');
    exportMissing(rows, format, file);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Find missing images</DialogTitle>
          <DialogDescription>
            {items.length} entr{items.length === 1 ? 'y has' : 'ies have'} no image. Pick a folder and every image inside
            it, including subfolders, is matched by name.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={search} disabled={scanning || items.length === 0}>
            {scanning ? <Loader2 className="animate-spin" /> : <FolderSearch />}
            {scanning ? `Scanning… ${scanned || ''}` : results ? 'Search another folder' : 'Choose folder to search'}
          </Button>
          {folder && (
            <span className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{folder.name}</span> · {folder.count} images scanned
            </span>
          )}
        </div>

        {results && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Filter results" className="flex gap-1 rounded-md bg-muted/40 p-1">
              {(['all', 'found', 'partial', 'missing'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t} ({counts[t]})
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => selectWhere((r) => r.status === 'found')}>
                Only 100%
              </Button>
              <Button variant="ghost" size="sm" onClick={() => selectWhere(() => true)}>
                All matched
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {!results ? (
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
              {items.map((i) => (
                <li key={i.entryKey} className="flex items-center gap-2 rounded border border-border/50 bg-muted/20 px-2 py-1.5">
                  <ImageOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{i.label || i.entryKey}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">{i.expectedName}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">No results in this tab</div>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((r) => {
                const k = r.item.entryKey;
                const style = STATUS_STYLE[r.status];
                const isSel = selected.has(k);
                const url = urls.get(k);
                return (
                  <li key={k}>
                    <button
                      type="button"
                      disabled={!r.match}
                      onClick={() => toggle(k)}
                      aria-pressed={r.match ? isSel : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors disabled:cursor-default',
                        style.card,
                        isSel && 'ring-2 ring-primary'
                      )}
                    >
                      {url ? (
                        <img src={url} alt={r.match!.name} className="icon-checker h-12 w-12 shrink-0 rounded border border-border/50 object-contain" />
                      ) : (
                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded border border-border/40 bg-muted/20">
                          <ImageOff className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium">{r.item.label || k}</span>
                          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', style.badge)}>
                            {r.status === 'missing' ? style.label : `${r.score}%`}
                          </span>
                        </div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground">{r.item.expectedName}</div>
                        {r.match && (
                          <div className="truncate font-mono text-[10px] text-muted-foreground/80" title={r.match.path}>
                            ← {r.match.path}
                            {r.candidates > 1 && ` (+${r.candidates - 1})`}
                          </div>
                        )}
                      </div>
                      {r.match && (
                        <span
                          aria-hidden
                          className={cn(
                            'grid h-4 w-4 shrink-0 place-items-center rounded border',
                            isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                          )}
                        >
                          {isSel && <Check className="h-3 w-3" />}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => exportUnmatched('json')}>
              <FileJson /> {results ? 'Export unresolved JSON' : 'Export JSON'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportUnmatched('csv')}>
              <FileSpreadsheet /> CSV
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {results && <Badge variant="secondary">{selected.size} selected</Badge>}
            <Button onClick={importSelected} disabled={!results || selected.size === 0 || importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />} Import selected
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
