/**
 * SSE Event Bus
 * Per-user EventEmitter channels for streaming job progress to SSE clients.
 */
import { EventEmitter } from 'events';

export type SSEEventType =
  | 'job_queued'
  | 'job_started'
  | 'job_progress'
  | 'file_pending'
  | 'file_hashed'
  | 'job_completed'
  | 'job_failed';

export interface SSEEvent {
  type: SSEEventType;
  jobId: string;
  payload?: Record<string, unknown>;
}

class SseEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Prevent MaxListenersExceededWarning for large user counts
    this.emitter.setMaxListeners(500);
  }

  emit(userId: string, event: SSEEvent): void {
    this.emitter.emit(`user:${userId}`, event);
  }

  subscribe(userId: string, handler: (event: SSEEvent) => void): () => void {
    const channel = `user:${userId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

export const sseEventBus = new SseEventBus();
