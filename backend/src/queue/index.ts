/**
 * BullMQ Queue Setup
 * Provides the indexing queue and connection to Redis.
 * Redis must be running locally (default: localhost:6379).
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export interface IndexingJobData {
  jobId: string;
  userId: string;
  type: 'local' | 'rclone';
  // local
  rootFolder?: string;
  // rclone
  remoteName?: string;
  basePath?: string;
  remoteType?: string;
}

export const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

export const INDEXING_QUEUE = 'indexing';

export const indexingQueue = new Queue<IndexingJobData>(INDEXING_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

/**
 * Enqueue an indexing job and return the BullMQ job id.
 */
export async function enqueueIndexingJob(data: IndexingJobData): Promise<string> {
  const job = await indexingQueue.add(data.type, data, {
    jobId: data.jobId,
  });
  return job.id!;
}
