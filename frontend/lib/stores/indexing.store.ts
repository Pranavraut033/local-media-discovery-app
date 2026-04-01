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

interface IndexingState {
  jobs: Record<string, IndexingJob>;
  /** Map from tempFileId → finalFileId for feed reconciliation */
  reconciliationMap: Record<string, string>;

  upsertJob: (job: Partial<IndexingJob> & { jobId: string }) => void;
  addReconciliation: (tempId: string, finalId: string) => void;
  clearCompleted: () => void;
  hasActiveJobs: () => boolean;
}

export const useIndexingStore = create<IndexingState>((set, get) => ({
  jobs: {},
  reconciliationMap: {},

  upsertJob: (partial) =>
    set((state) => ({
      jobs: {
        ...state.jobs,
        [partial.jobId]: { ...(state.jobs[partial.jobId] ?? { jobId: partial.jobId, status: 'queued' }), ...partial },
      },
    })),

  addReconciliation: (tempId, finalId) =>
    set((state) => ({
      reconciliationMap: { ...state.reconciliationMap, [tempId]: finalId },
    })),

  clearCompleted: () =>
    set((state) => {
      const jobs = { ...state.jobs };
      for (const key of Object.keys(jobs)) {
        if (jobs[key].status === 'completed' || jobs[key].status === 'failed') {
          delete jobs[key];
        }
      }
      return { jobs };
    }),

  hasActiveJobs: () => {
    const { jobs } = get();
    return Object.values(jobs).some((j) => j.status === 'queued' || j.status === 'processing');
  },
}));
