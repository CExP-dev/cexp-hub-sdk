import type { IntegrationToggles } from "../types";
import type { IntegrationKey } from "../config/schema";
import type { HubContext, Plugin } from "../plugins/types";
import { createSpaPageView, DEFAULT_SPA_PAGE_DEBOUNCE_MS } from "./SpaPageView";
import { IdentityStore } from "./IdentityStore";

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
  private readonly anonymousIdOverride: string | null | undefined;

  private initialized = false;
  private currentToggles: IntegrationToggles | undefined;

  private spaHandle?: ReturnType<typeof createSpaPageView>;

  constructor(options: HubOptions = {}) {
    this.anonymousIdOverride = options.anonymousId;

    const overrides = options.pluginOverrides ?? {};
    for (const integrationKey of PLUGIN_ORDER) {
      const plugin = overrides[integrationKey] ?? new NoopPlugin(integrationKey);

      // Runtime guard: integration key drives registry lookup and lifecycle routing.
      // If plugin.name doesn't match, later tasks/tests may silently route events incorrectly.
      if (plugin.name !== integrationKey) {
        throw new Error(
          `[Hub] Plugin name mismatch for integrationKey "${integrationKey}": expected plugin.name === integrationKey (got "${plugin.name}").`,
        );
      }

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

  getPlugins(): Map<string, Plugin> {
    return this.plugins;
  }

  getContext(): HubContext {
    return {
      // Important: read toggles at call time to avoid stale closure state after `setToggles()`.
      getToggles: () => this.currentToggles ?? DEFAULT_TOGGLES,
      getAnonymousId: () => {
        if (typeof this.anonymousIdOverride === "string") return this.anonymousIdOverride;
        return IdentityStore.getOrCreateFptUuid();
      },
      getUserId: () => null,
    };
  }

  /**
   * Deterministic list of registry keys in the order Hub registers plugins.
   * Useful for testing/reporting.
   */
  getPluginOrder(): string[] {
    return [...PLUGIN_ORDER];
  }

  /**
   * Subscribe to SPA navigations (`pushState` / `replaceState` / `popstate`) and
   * emit debounced page payloads. Replaces any previous SPA subscription.
   *
   * Call `notifySpaExplicitPage()` when routing an explicit `CExP.page()` so the
   * debounced SPA callback does not duplicate that view.
   */
  enableSpaPageView(
    onPage: (props: Record<string, unknown>) => void,
    debounceMs: number = DEFAULT_SPA_PAGE_DEBOUNCE_MS,
  ): void {
    this.disableSpaPageView();
    this.spaHandle = createSpaPageView({ debounceMs, onPage });
  }

  disableSpaPageView(): void {
    this.spaHandle?.stop();
    this.spaHandle = undefined;
  }

  notifySpaExplicitPage(): void {
    this.spaHandle?.notifyExplicitPage();
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

}

