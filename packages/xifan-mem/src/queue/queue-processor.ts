import { randomUUID } from 'node:crypto';

import type {
  CreateObservationInput,
  CreateSessionSummaryInput,
  QueueItemRecord,
} from '../types.js';
import {
  ObservationGenerator,
  type QueueLLMDriver,
} from '../llm/observation-generator.js';
import { SummaryGenerator } from '../llm/summary-generator.js';
import { ObservationStore } from '../db/observation-store.js';
import { QueueStore } from '../db/queue-store.js';
import { SessionSummaryStore } from '../db/summary-store.js';

interface QueueProcessorSleep {
  (ms: number): Promise<void>;
}

export interface QueueProcessorOptions {
  readonly pollIntervalMs?: number;
  readonly idlePauseMs?: number;
  readonly maxRetries?: number;
  readonly now?: () => number;
  readonly sleep?: QueueProcessorSleep;
  readonly idGenerator?: () => string;
}

interface ObservationQueuePayload {
  readonly kind: 'observation';
  readonly memSessionId: string;
  readonly project: string;
  readonly promptNumber: number;
  readonly sourceText: string;
}

interface SummaryQueuePayload {
  readonly kind: 'summarize';
  readonly memSessionId: string;
  readonly project: string;
  readonly sourceText: string;
}

type QueuePayload = ObservationQueuePayload | SummaryQueuePayload;

function safeJsonParse(payload: string): QueuePayload {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_queue_payload');
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.kind === 'observation') {
    return {
      kind: 'observation',
      memSessionId: String(candidate.memSessionId ?? ''),
      project: String(candidate.project ?? ''),
      promptNumber: Number(candidate.promptNumber ?? 0),
      sourceText: String(candidate.sourceText ?? ''),
    };
  }
  if (candidate.kind === 'summarize') {
    return {
      kind: 'summarize',
      memSessionId: String(candidate.memSessionId ?? ''),
      project: String(candidate.project ?? ''),
      sourceText: String(candidate.sourceText ?? ''),
    };
  }
  throw new Error('invalid_queue_payload_kind');
}

function encodePayloadWithError(payload: string, errorMessage: string): string {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return JSON.stringify({
      ...parsed,
      lastError: errorMessage,
    });
  } catch {
    return JSON.stringify({
      rawPayload: payload,
      lastError: errorMessage,
    });
  }
}

export class QueueProcessor {
  private readonly queueStore: QueueStore;
  private readonly observationStore: ObservationStore;
  private readonly summaryStore: SessionSummaryStore;
  private readonly observationGenerator: ObservationGenerator;
  private readonly summaryGenerator: SummaryGenerator;
  private readonly pollIntervalMs: number;
  private readonly idlePauseMs: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: QueueProcessorSleep;
  private readonly idGenerator: () => string;
  private running = false;
  private pausedByIdle = false;

  constructor(
    driver: QueueLLMDriver,
    queueStore: QueueStore,
    observationStore: ObservationStore,
    summaryStore: SessionSummaryStore,
    options: QueueProcessorOptions = {},
  ) {
    this.queueStore = queueStore;
    this.observationStore = observationStore;
    this.summaryStore = summaryStore;
    this.observationGenerator = new ObservationGenerator(driver);
    this.summaryGenerator = new SummaryGenerator(driver);
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.idlePauseMs = options.idlePauseMs ?? 3 * 60 * 1000;
    this.maxRetries = options.maxRetries ?? 3;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  isRunning(): boolean {
    return this.running;
  }

  isPausedByIdle(): boolean {
    return this.pausedByIdle;
  }

  async start(): Promise<void> {
    /* v8 ignore next 3 -- guard against concurrent start(); start() blocks until loop ends */
    if (this.running) {
      return;
    }
    this.running = true;
    this.pausedByIdle = false;
    this.queueStore.resetStale();

    let lastActiveAt = this.now();
    while (this.running) {
      const processed = await this.processOnce();
      if (processed) {
        lastActiveAt = this.now();
        continue;
      }

      if (this.now() - lastActiveAt >= this.idlePauseMs) {
        this.pausedByIdle = true;
        this.running = false;
        break;
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  async processOnce(): Promise<boolean> {
    const item = this.queueStore.claim();
    if (!item) {
      return false;
    }

    try {
      await this.processClaimedItem(item);
      this.queueStore.done(item.id);
      return true;
    } catch (error) {
      const failed = this.queueStore.fail(item.id);
      const retryCount = failed?.retryCount ?? this.maxRetries;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (retryCount < this.maxRetries) {
        this.requeueWithError(item, errorMessage);
      } else {
        const payload = encodePayloadWithError(item.payload, errorMessage);
        this.queueStore.updatePayload(item.id, payload);
      }
      return true;
    }
  }

  private async processClaimedItem(item: QueueItemRecord): Promise<void> {
    const payload = safeJsonParse(item.payload);
    if (payload.kind === 'observation') {
      const generated = await this.observationGenerator.generate({
        id: this.idGenerator(),
        memSessionId: payload.memSessionId,
        project: payload.project,
        promptNumber: payload.promptNumber,
        sourceText: payload.sourceText,
      });
      this.persistObservation(generated);
      return;
    }

    const generated = await this.summaryGenerator.generate({
      id: this.idGenerator(),
      memSessionId: payload.memSessionId,
      project: payload.project,
      sourceText: payload.sourceText,
    });
    if (generated) {
      this.persistSummary(generated);
    }
  }

  private persistObservation(input: CreateObservationInput): void {
    this.observationStore.create(input);
  }

  private persistSummary(input: CreateSessionSummaryInput): void {
    this.summaryStore.create(input);
  }

  private requeueWithError(item: QueueItemRecord, errorMessage: string): void {
    const failed = this.queueStore.findById(item.id);
    /* v8 ignore next 3 -- defensive: item was just claimed so must exist */
    if (!failed) {
      return;
    }
    const payload = encodePayloadWithError(failed.payload, errorMessage);
    this.queueStore.updatePayload(failed.id, payload);
    this.queueStore.enqueue({
      id: `${failed.id}-retry-${failed.retryCount}`,
      type: failed.type,
      payload,
      retryCount: failed.retryCount,
      status: 'pending',
    });
  }
}
