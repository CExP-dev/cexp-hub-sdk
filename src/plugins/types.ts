import type { IntegrationToggles } from "../types";

export interface HubContext {
  /**
   * Current enabled/disabled state for each integration.
   */
  getToggles(): IntegrationToggles;

  /**
   * Canonical anonymous id for this runtime.
   *
   * May return `null` if identity plumbing is not enabled yet.
   */
  getAnonymousId(): string | null;

  /**
   * Known user id, when available.
   *
   * Intentionally stubbed for now (Task 7 will wire identity).
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
   * Called when the integration is torn down.
   */
  destroy?(): void;
}

