'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import { useIndexingStore } from '@/lib/stores/indexing.store';
import { setJobCompleteCallback } from '@/lib/sse';

/**
 * Floating overlay that shows scanning and indexing progress.
 * - Scan phase: spinner + "X folders, Y files found" (from scan_progress SSE events)
 * - Hash phase: progress bar + "Indexing Y files…" (from file_hashed SSE events)
 * - Auto-dismisses 2 s after job completes; has manual × dismiss.
 *
 * Placed inside MainLayout so it overlays all views.
 */
export default function ScanningProgressDialog() {
  const queryClient = useQueryClient();
  const scanProgress = useIndexingStore((s) => s.scanProgress);
  const jobs = useIndexingStore((s) => s.jobs);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const autoDismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const timedJobsRef = useRef<Set<string>>(new Set());
  const prevFilesFoundRef = useRef<Record<string, number>>({});

  // Invalidate the feed cache when hashing finishes so newly indexed files appear.
  useEffect(() => {
    setJobCompleteCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    });
    return () => { setJobCompleteCallback(() => {}); };
  }, [queryClient]);

  // Invalidate feed cache the moment the first pending files are written to DB,
  // so media appears before hashing even starts.
  useEffect(() => {
    for (const [jobId, scan] of Object.entries(scanProgress)) {
      const prev = prevFilesFoundRef.current[jobId] ?? 0;
      if (scan.filesFound > 0 && prev === 0) {
        queryClient.invalidateQueries({ queryKey: ['feed'] });
      }
      prevFilesFoundRef.current[jobId] = scan.filesFound;
    }
  }, [scanProgress, queryClient]);

  // Auto-dismiss 2 s after a job completes or fails.
  // Use a ref to gate per-job timers so we don't set up duplicates across re-renders.
  useEffect(() => {
    for (const [jobId, job] of Object.entries(jobs)) {
      if ((job.status === 'completed' || job.status === 'failed') && !timedJobsRef.current.has(jobId)) {
        timedJobsRef.current.add(jobId);
        autoDismissTimers.current[jobId] = setTimeout(() => {
          setDismissed((prev) => new Set(prev).add(jobId));
        }, 2000);
      }
    }
  }, [jobs]);

  useEffect(() => {
    const timers = autoDismissTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // Pick the most-relevant job to display: scanning first, then hashing, then completed.
  const activeJobId = (() => {
    // Prefer a job that is actively scanning
    const scanning = Object.keys(scanProgress).find(
      (id) => !dismissed.has(id) && scanProgress[id].isScanning
    );
    if (scanning) return scanning;

    // Then a job that is hashing
    const hashing = Object.keys(jobs).find(
      (id) => !dismissed.has(id) && jobs[id].status === 'processing'
    );
    if (hashing) return hashing;

    // Then a recently-completed job waiting for auto-dismiss
    const completed = Object.keys(jobs).find(
      (id) => !dismissed.has(id) && (jobs[id].status === 'completed' || jobs[id].status === 'failed')
    );
    return completed ?? null;
  })();

  if (!activeJobId) return null;

  const scan = scanProgress[activeJobId];
  const job = jobs[activeJobId];
  const isScanning = scan?.isScanning === true;
  const isCompleted = job?.status === 'completed';
  const hashTotal = job?.total ?? scan?.filesFound ?? 0;
  const hashDone = job?.done ?? 0;
  const hashPct = hashTotal > 0 ? Math.round((hashDone / hashTotal) * 100) : 0;

  return (
    <div className="fixed bottom-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm bg-(--surface-low) border border-(--outline-variant) rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        {/* Status icon */}
        <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center bg-blue-500/15">
          {isCompleted
            ? <CheckCircle2 size={18} className="text-green-400" />
            : <Loader2 size={18} className="text-blue-400 animate-spin" />
          }
        </div>

        {/* Text + progress */}
        <div className="flex-1 min-w-0">
          {isCompleted ? (
            <p className="text-sm font-semibold text-(--surface-ink)">Library ready</p>
          ) : isScanning ? (
            <>
              <p className="text-sm font-semibold text-(--surface-ink)">Scanning library…</p>
              <p className="text-xs text-(--surface-muted) mt-0.5">
                {scan.foldersFound} folder{scan.foldersFound !== 1 ? 's' : ''}&ensp;·&ensp;{scan.filesFound} file{scan.filesFound !== 1 ? 's' : ''} found
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-(--surface-ink)">
                Indexing {hashTotal} file{hashTotal !== 1 ? 's' : ''}…
              </p>
              {hashTotal > 0 && (
                <div className="mt-2 h-1 w-full rounded-full bg-(--outline-variant) overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${hashPct}%` }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={() => setDismissed((prev) => new Set(prev).add(activeJobId))}
          className="shrink-0 -mt-0.5 -mr-1 p-1.5 rounded-lg text-(--surface-muted) hover:text-(--surface-ink) transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
