import type { HubContext, Plugin } from "../types";

export type SnowplowIdentifyCall = {
  userId: string;
  traits?: Record<string, unknown>;
};

export type SnowplowTrackCall = {
  event: string;
  props: Record<string, unknown>;
};

export type SnowplowPageCall = {
  props: Record<string, unknown>;
};

/**
 * Snowplow plugin stub used by unit tests.
 *
 * Task 9 will replace this with real browser Snowplow loading/integration.
 */
export class SnowplowPlugin implements Plugin {
  public readonly name = "snowplow";

  public readonly identifyCalls: SnowplowIdentifyCall[] = [];
  public readonly trackCalls: SnowplowTrackCall[] = [];
  public readonly pageCalls: SnowplowPageCall[] = [];

  /**
   * Lightweight ordering helper for tests.
   * Each call appends a string like `identify:<userId>` or `track:<event>`.
   */
  public readonly callSequence: string[] = [];

  init(_ctx: HubContext, _config: unknown): void {
    // Intentionally empty (Task 9: real Snowplow integration).
  }

  onToggle(_enabled: boolean): void {
    // Intentionally empty (Task 9: enable/disable Snowplow tracker).
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    this.identifyCalls.push({ userId, traits });
    this.callSequence.push(`identify:${userId}`);
  }

  track(event: string, props: Record<string, unknown>): void {
    this.trackCalls.push({ event, props });
    this.callSequence.push(`track:${event}`);
  }

  page(props: Record<string, unknown>): void {
    this.pageCalls.push({ props });
    this.callSequence.push(`page:${this.pageCalls.length}`);
  }
}

