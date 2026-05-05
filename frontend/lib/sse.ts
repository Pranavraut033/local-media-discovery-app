/**
 * SSE Client Utility
 * Connects to the backend SSE endpoint and dispatches events to the indexing store.
 * Handles auth, reconnection, and cleanup.
 */
import { getStoredToken } from './storage';
import { useIndexingStore } from './stores/indexing.store';
import { getApiBase } from './api';

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = true;

/** Called when any job reaches 'completed'. Used by ScanningProgressDialog to invalidate feed. */
let _onJobComplete: (() => void) | null = null;
export function setJobCompleteCallback(cb: () => void): void {
  _onJobComplete = cb;
}

const SSE_EVENTS = [
  'job_queued',
  'job_started',
  'scan_progress',
  'job_progress',
  'file_pending',
  'file_hashed',
  'job_completed',
  'job_failed',
] as const;

function handleEvent(type: string, data: Record<string, unknown>): void {
  const { upsertJob, addReconciliation, updateScanProgress, completeScan } = useIndexingStore.getState();
  const jobId = data.jobId as string | undefined;
  if (!jobId) return;

  switch (type) {
    case 'job_queued':
      upsertJob({ jobId, status: 'queued', sourcePath: data.sourcePath as string | undefined });
      break;
    case 'job_started':
      upsertJob({ jobId, status: 'processing' });
      break;
    case 'scan_progress': {
      const foldersScanned = data.foldersScanned as number ?? 0;
      const filesFound = data.filesFound as number ?? 0;
      updateScanProgress(jobId, foldersScanned, filesFound);
      break;
    }
    case 'job_progress': {
      const stage = data.stage as 'discovery' | 'hashing' | undefined;
      if (stage === 'discovery') {
        // Scan phase is done — transition scan dialog to hashing mode
        completeScan(jobId);
        upsertJob({ jobId, stage: 'discovery', filesFound: data.filesFound as number | undefined });
      } else {
        upsertJob({
          jobId,
          status: (data.status as 'queued' | 'processing' | undefined) ?? 'processing',
          done: data.done as number | undefined,
          total: data.total as number | undefined,
          sourcePath: data.sourcePath as string | undefined,
        });
      }
      break;
    }
    case 'file_hashed': {
      const tempId = data.tempId as string | undefined;
      const finalId = data.finalId as string | undefined;
      if (tempId && finalId && tempId !== finalId) {
        addReconciliation(tempId, finalId);
      }
      upsertJob({
        jobId,
        stage: 'hashing',
        done: data.done as number | undefined,
        total: data.total as number | undefined,
      });
      break;
    }
    case 'job_completed':
      upsertJob({ jobId, status: 'completed' });
      _onJobComplete?.();
      break;
    case 'job_failed':
      upsertJob({ jobId, status: 'failed', error: data.error as string | undefined });
      break;
  }
}

export function connectSSE(): void {
  if (typeof window === 'undefined') return;

  const token = getStoredToken();
  if (!token) return;

  shouldReconnect = true;
  openConnection(token);
}

function openConnection(token: string): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const url = `${getApiBase()}/api/events/stream?token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);

  for (const eventType of SSE_EVENTS) {
    eventSource.addEventListener(eventType, (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data ?? '{}') as Record<string, unknown>;
        // Inject jobId from event data (server sends it in `data`)
        handleEvent(eventType, data);
      } catch {
        // ignore parse errors
      }
    });
  }

  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    if (shouldReconnect) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        const t = getStoredToken();
        if (t && shouldReconnect) openConnection(t);
      }, 5000);
    }
  };
}

export function disconnectSSE(): void {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}
