import type { HubContext, Plugin } from "../plugins/types";

type IdentifyQueueEntry = {
  enqueuedAtMs: number;
  userId: string;
  traits?: Record<string, unknown>;
};

/**
 * Identify queue rules for Snowplow when the integration is disabled.
 *
 * - `identify` is queued (bounded by max size + TTL).
 * - `track`/`page` are dropped.
 * - When Snowplow becomes enabled, queued identifies are flushed in FIFO order
 *   *before* processing subsequent live events.
 */
export const IDENTIFY_QUEUE_MAX_SIZE = 50;
export const IDENTIFY_QUEUE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Event router skeleton.
 *
 * Task 5+ will implement routing rules and plugin delegation (e.g. Snowplow queue).
 * For Task 4 we only need the class/API surface so Hub facade can compile later.
 */
export class EventRouter {
  // Keep references to avoid accidental tree-shaking/unused-param warnings.
  private readonly ctx: HubContext;
  private readonly plugins: Map<string, Plugin>;
  private identifyQueue: IdentifyQueueEntry[] = [];

  constructor(args: { ctx: HubContext; plugins: Map<string, Plugin> }) {
    this.ctx = args.ctx;
    this.plugins = args.plugins;
  }

  track(_event: string, _props?: Record<string, unknown>): void {
    const snowplowEnabled = this.ctx.getToggles().snowplow;
    const snowplow = this.plugins.get("snowplow");

    if (!snowplowEnabled) {
      // Snowplow disabled => drop track/page events.
      return;
    }

    // Snowplow enabled => flush identify queue before processing live events.
    this.flushIdentifyQueue(snowplow);
    snowplow?.track?.(_event, _props ?? {});
  }

  page(_props?: Record<string, unknown>): void {
    const snowplowEnabled = this.ctx.getToggles().snowplow;
    const snowplow = this.plugins.get("snowplow");

    if (!snowplowEnabled) {
      // Snowplow disabled => drop track/page events.
      return;
    }

    this.flushIdentifyQueue(snowplow);
    snowplow?.page?.(_props ?? {});
  }

  identify(_userId: string, _traits?: Record<string, unknown>): void {
    const snowplowEnabled = this.ctx.getToggles().snowplow;
    const snowplow = this.plugins.get("snowplow");

    if (!snowplowEnabled) {
      // Snowplow disabled => queue identify only.
      this.enqueueIdentify({ userId: _userId, traits: _traits });
      return;
    }

    // Snowplow enabled => flush identify queue before processing live events.
    this.flushIdentifyQueue(snowplow);
    snowplow?.identify?.(_userId, _traits);
  }

  private enqueueIdentify(entry: { userId: string; traits?: Record<string, unknown> }): void {
    const now = Date.now();
    this.pruneIdentifyQueue(now);

    if (this.identifyQueue.length >= IDENTIFY_QUEUE_MAX_SIZE) {
      // Bounded queue: drop oldest (FIFO) to keep the queue size <= max.
      const overflow = this.identifyQueue.length - IDENTIFY_QUEUE_MAX_SIZE + 1;
      this.identifyQueue.splice(0, overflow);
    }

    this.identifyQueue.push({
      enqueuedAtMs: now,
      userId: entry.userId,
      traits: entry.traits,
    });
  }

  private flushIdentifyQueue(snowplow: Plugin | undefined): void {
    // If snowplow is missing while enabled, we can't forward queued identifies.
    // Keep the queue to avoid losing data; later tasks will ensure plugin always exists.
    const canFlush = Boolean(snowplow?.identify);
    if (!canFlush) return;

    const now = Date.now();
    this.pruneIdentifyQueue(now);

    while (this.identifyQueue.length > 0) {
      const next = this.identifyQueue.shift();
      if (!next) break;
      snowplow?.identify?.(next.userId, next.traits);
    }
  }

  private pruneIdentifyQueue(nowMs: number): void {
    const cutoffMs = nowMs - IDENTIFY_QUEUE_TTL_MS;
    // Prune expired entries. Keep relative order for FIFO flush.
    this.identifyQueue = this.identifyQueue.filter((e) => e.enqueuedAtMs >= cutoffMs);
  }
}

