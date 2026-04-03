import type { IntegrationToggles } from "../types";

export interface HubContext {
  /**
   * Current enabled/disabled state for each integration.
   */
  getToggles(): IntegrationToggles;

  /**
   * Known user id, when available.
   *
   * Intentionally stubbed for now (OneSignal wiring later).
   */
  getUserId(): string | null;
}

export interface Plugin {
  /**
   * Stable registry key.
   */
  name: string;

  /**
   * Called once during hub initialization.
   */
  init(ctx: HubContext, config: unknown): Promise<void> | void;

  /**
   * Called whenever a specific integration toggle changes.
   */
  onToggle(enabled: boolean): void;

  /**
   * Optional event hook for event tracking.
   *
   * Used by later tasks to delegate routing to plugins.
   */
  track?(event: string, props: Record<string, unknown>): void;

  /**
   * Optional hook for page/view navigation events.
   */
  page?(props: Record<string, unknown>): void;

  /**
   * Optional hook for identity updates.
   */
  identify?(userId: string, traits?: Record<string, unknown>): void;

  /**
   * Optional hook for resetting internal plugin state.
   */
  reset?(): void;

  /**
   * Called when the integration is torn down.
   */
  destroy?(): void;
}
