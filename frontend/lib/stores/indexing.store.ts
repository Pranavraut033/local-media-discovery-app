/**
 * Indexing Progress Store
 * Tracks per-job indexing progress received via SSE.
 * Also tracks temp→final ID reconciliation map for feed state.
 */
import { create } from 'zustand';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface IndexingJob {
  jobId: string;
  status: JobStatus;
  stage?: 'discovery' | 'hashing';
  filesFound?: number;
  done?: number;
  total?: number;
  error?: string;
  sourcePath?: string;
}

export interface ScanState {
  foldersFound: number;
  filesFound: number;
  /** true while scan_progress events are arriving; false once job_progress(discovery) fires */
  isScanning: boolean;
}

interface IndexingState {
  jobs: Record<string, IndexingJob>;
  /** Live scan progress per jobId, populated by scan_progress SSE events */
  scanProgress: Record<string, ScanState>;
  /** Map from tempFileId → finalFileId for feed reconciliation */
  reconciliationMap: Record<string, string>;

  upsertJob: (job: Partial<IndexingJob> & { jobId: string }) => void;
  updateScanProgress: (jobId: string, foldersFound: number, filesFound: number) => void;
  completeScan: (jobId: string) => void;
  addReconciliation: (tempId: string, finalId: string) => void;
  clearCompleted: () => void;
  hasActiveJobs: () => boolean;
}

export const useIndexingStore = create<IndexingState>((set, get) => ({
  jobs: {},
  scanProgress: {},
  reconciliationMap: {},

  upsertJob: (partial) =>
    set((state) => ({
      jobs: {
        ...state.jobs,
        [partial.jobId]: { ...(state.jobs[partial.jobId] ?? { jobId: partial.jobId, status: 'queued' }), ...partial },
      },
    })),

  updateScanProgress: (jobId, foldersFound, filesFound) =>
    set((state) => ({
      scanProgress: {
        ...state.scanProgress,
        [jobId]: { foldersFound, filesFound, isScanning: true },
      },
    })),

  completeScan: (jobId) =>
    set((state) => {
      const existing = state.scanProgress[jobId];
      if (!existing) return state;
      return {
        scanProgress: {
          ...state.scanProgress,
          [jobId]: { ...existing, isScanning: false },
        },
      };
    }),

  addReconciliation: (tempId, finalId) =>
    set((state) => ({
      reconciliationMap: { ...state.reconciliationMap, [tempId]: finalId },
    })),

  clearCompleted: () =>
    set((state) => {
      const jobs = { ...state.jobs };
      const scanProgress = { ...state.scanProgress };
      for (const key of Object.keys(jobs)) {
        if (jobs[key].status === 'completed' || jobs[key].status === 'failed') {
          delete jobs[key];
          delete scanProgress[key];
        }
      }
      return { jobs, scanProgress };
    }),

  hasActiveJobs: () => {
    const { jobs } = get();
    return Object.values(jobs).some((j) => j.status === 'queued' || j.status === 'processing');
  },
}));
