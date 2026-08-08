/**
 * In-process indexing queue.
 * ponytail: single Node process supervises everything (see desktop/main.cjs) —
 * jobs don't survive a process restart, but reindexing is idempotent so
 * nothing is lost. Revisit with a persistent queue (Redis/BullMQ) if job
 * durability across restarts ever matters.
 */
export interface IndexingJobData {
  jobId: string;
  userId: string;
  type: 'local' | 'rclone' | 'remote';
  // local
  rootFolder?: string;
  // rclone (legacy)
  remoteName?: string;
  basePath?: string;
  remoteType?: string;
  // remote (new generic path via remote_servers)
  serverId?: string;
  serverType?: string;
  remotePath?: string;
}

type JobProcessor = (data: IndexingJobData) => Promise<void>;

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2000;

let processJob: JobProcessor | null = null;
const pending: IndexingJobData[] = [];
const attemptsById = new Map<string, number>();
let runningCount = 0;

/** Registered once by the worker module at startup. */
export function registerIndexingProcessor(fn: JobProcessor): void {
  processJob = fn;
}

/**
 * Enqueue an indexing job. Returns the same jobId the caller passed in
 * (the caller already persisted an `indexing_jobs` row under this id).
 */
export async function enqueueIndexingJob(data: IndexingJobData): Promise<string> {
  pending.push(data);
  pump();
  return data.jobId;
}

function pump(): void {
  if (!processJob) return;
  while (runningCount < CONCURRENCY && pending.length > 0) {
    const data = pending.shift()!;
    runningCount++;
    processJob(data)
      .catch((err) => {
        const attempts = (attemptsById.get(data.jobId) ?? 0) + 1;
        attemptsById.set(data.jobId, attempts);
        if (attempts < MAX_ATTEMPTS) {
          const delay = BACKOFF_BASE_MS * 2 ** (attempts - 1);
          setTimeout(() => { pending.push(data); pump(); }, delay);
        } else {
          console.error(`[queue] job ${data.jobId} failed after ${attempts} attempts:`, err);
          attemptsById.delete(data.jobId);
        }
      })
      .finally(() => {
        runningCount--;
        pump();
      });
  }
}
