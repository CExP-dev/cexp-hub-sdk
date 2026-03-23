import type { IntegrationToggles } from "../types";
import type { IntegrationKey } from "../config/schema";
import type { HubContext, Plugin } from "../plugins/types";

const DEFAULT_TOGGLES: IntegrationToggles = {
  snowplow: false,
  onesignal: false,
  gamification: false,
  identity: false,
};

// Fixed integration/plugin registry order.
// Keep this stable because later tasks may depend on deterministic init/teardown sequencing.
const PLUGIN_ORDER: IntegrationKey[] = ["snowplow", "onesignal", "identity", "gamification"];

class NoopPlugin implements Plugin {
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  init(_ctx: HubContext, _config: unknown): void {
    // Intentionally empty (Task 5+ implement real plugins).
  }

  onToggle(_enabled: boolean): void {
    // Intentionally empty.
  }
}

export interface HubOptions {
  /**
   * Anonymous id provider for HubContext.
   *
   * For Task 4 tests, this can be a stable string. Identity persistence is implemented later.
   */
  anonymousId?: string | null;

  /**
   * Optional dependency injection for unit tests.
   * Plugins are still registered in `PLUGIN_ORDER`.
   */
  pluginOverrides?: Partial<Record<IntegrationKey, Plugin>>;
}

/**
 * Minimal plugin registry + lifecycle.
 *
 * Task 4 only covers registration and toggle lifecycle; event routing integration
 * happens later (Task 12+).
 */
export class Hub {
  private readonly plugins = new Map<string, Plugin>();
  private readonly anonymousId: string | null;

  private initialized = false;
  private currentToggles: IntegrationToggles | undefined;

  constructor(options: HubOptions = {}) {
    this.anonymousId = options.anonymousId ?? null;

    const overrides = options.pluginOverrides ?? {};
    for (const integrationKey of PLUGIN_ORDER) {
      const plugin = overrides[integrationKey] ?? new NoopPlugin(integrationKey);
      // Map key is the deterministic registry key (integration key).
      // `Plugin.name` is still expected to match this for later tasks/tests.
      this.plugins.set(integrationKey, plugin);
    }
  }

  /**
   * Used by the unit tests and later wiring code to trigger lifecycle transitions.
   */
  setToggles(next: IntegrationToggles): void {
    const prev = this.currentToggles;
    this.currentToggles = next;

    this.ensureInitialized();

    // Call onToggle for each plugin that changed (including initial sync).
    for (const integrationKey of PLUGIN_ORDER) {
      const plugin = this.plugins.get(integrationKey);
      if (!plugin) continue;
      const prevEnabled = prev ? prev[integrationKey] : undefined;
      const enabled = next[integrationKey];
      if (prevEnabled !== enabled) {
        plugin.onToggle(enabled);
      }
    }
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Deterministic list of registry keys in the order Hub registers plugins.
   * Useful for testing/reporting.
   */
  getPluginOrder(): string[] {
    return [...PLUGIN_ORDER];
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    const ctx = this.getContext();
    for (const integrationKey of PLUGIN_ORDER) {
      const plugin = this.plugins.get(integrationKey);
      if (!plugin) continue;
      plugin.init(ctx, {});
    }
  }

  private getContext(): HubContext {
    return {
      // Important: read toggles at call time to avoid stale closure state after `setToggles()`.
      getToggles: () => this.currentToggles ?? DEFAULT_TOGGLES,
      getAnonymousId: () => this.anonymousId,
      getUserId: () => null,
    };
  }
}

