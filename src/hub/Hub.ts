import type { IntegrationToggles } from "../types";
import type { ControlConfig, IntegrationKey } from "../config/schema";
import type { HubContext, Plugin } from "../plugins/types";
import { createSpaPageView, DEFAULT_SPA_PAGE_DEBOUNCE_MS } from "./SpaPageView";

const DEFAULT_TOGGLES: IntegrationToggles = {
  onesignal: false,
  gamification: false,
};

// Fixed integration/plugin registry order.
// Keep this stable because later tasks may depend on deterministic init/teardown sequencing.
const PLUGIN_ORDER: IntegrationKey[] = ["onesignal", "gamification"];

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

  private currentControlConfig: ControlConfig | undefined;
  private initialized = false;
  private currentToggles: IntegrationToggles | undefined;

  private spaHandle?: ReturnType<typeof createSpaPageView>;

  constructor(options: HubOptions = {}) {
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

    // Keep ControlConfig-like state in sync for ctx.getToggles() consumers.
    // Note: this does NOT trigger plugin.init; only setControlConfig() does that.
    this.currentControlConfig = {
      version: this.currentControlConfig?.version ?? 0,
      integrations: {
        onesignal: { enabled: next.onesignal },
        gamification: { enabled: next.gamification },
      },
    };

    // If plugins were initialized via setControlConfig(), allow setToggles() to
    // propagate onToggle changes without re-initializing.
    if (this.initialized && prev) {
      for (const integrationKey of PLUGIN_ORDER) {
        const plugin = this.plugins.get(integrationKey);
        if (!plugin) continue;
        const prevEnabled = prev[integrationKey];
        const enabled = next[integrationKey];
        if (prevEnabled !== enabled) plugin.onToggle(enabled);
      }
    }
  }

  /**
   * Apply remote control config and initialize/re-initialize plugins as needed.
   */
  async setControlConfig(next: ControlConfig): Promise<void> {
    const prevControlConfig = this.currentControlConfig;
    const prevGamification = prevControlConfig?.integrations.gamification;

    this.currentControlConfig = next;
    this.currentToggles = this.deriveTogglesFromControlConfig(next);

    const ctx = this.getContext();

    // First-time init: init *all* plugins in deterministic order before enabling any.
    if (!this.initialized) {
      for (const integrationKey of PLUGIN_ORDER) {
        const plugin = this.plugins.get(integrationKey);
        if (!plugin) continue;
        await plugin.init(ctx, next.integrations[integrationKey] ?? { enabled: false });
      }

      for (const integrationKey of PLUGIN_ORDER) {
        const plugin = this.plugins.get(integrationKey);
        if (!plugin) continue;
        const enabled = next.integrations[integrationKey].enabled;
        if (enabled) plugin.onToggle(true);
      }

      this.initialized = true;
      return;
    }

    // Subsequent updates:
    // - non-gamification: only onToggle when enabled flag changes
    // - gamification:
    //   - false -> true: init then onToggle(true)
    //   - true -> true with cfg change: init then onToggle(false) then onToggle(true)
    //   - false -> false with cfg change: optional init-only refresh
    for (const integrationKey of PLUGIN_ORDER) {
      const plugin = this.plugins.get(integrationKey);
      if (!plugin) continue;

      if (integrationKey === "gamification") {
        if (!prevGamification) continue; // should not happen once initialized is true

        const prevEnabled = prevGamification.enabled;
        const nextGamification = next.integrations.gamification;
        const nextEnabled = nextGamification.enabled;

        if (prevEnabled !== nextEnabled) {
          if (!prevEnabled && nextEnabled) {
            await plugin.init(ctx, nextGamification ?? { enabled: false });
            plugin.onToggle(true);
          } else {
            plugin.onToggle(false);
          }
          continue;
        }

        // enabled didn't change
        if (nextEnabled) {
          const apiKeyChanged = prevGamification.apiKey !== nextGamification.apiKey;
          const packageVersionChanged = prevGamification.packageVersion !== nextGamification.packageVersion;
          if (apiKeyChanged || packageVersionChanged) {
            await plugin.init(ctx, nextGamification ?? { enabled: false });
            plugin.onToggle(false);
            plugin.onToggle(true);
          }
        } else {
          // Optional refresh: keep the config up to date for the next enable transition.
          const apiKeyChanged = prevGamification.apiKey !== nextGamification.apiKey;
          const packageVersionChanged = prevGamification.packageVersion !== nextGamification.packageVersion;
          if (apiKeyChanged || packageVersionChanged) {
            await plugin.init(ctx, nextGamification ?? { enabled: false });
          }
        }

        continue;
      }

      // Non-gamification integration
      const prevEnabled = prevControlConfig!.integrations[integrationKey].enabled;
      const enabled = next.integrations[integrationKey].enabled;
      if (prevEnabled !== enabled) plugin.onToggle(enabled);
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

  private deriveTogglesFromControlConfig(cfg: ControlConfig): IntegrationToggles {
    return {
      onesignal: cfg.integrations.onesignal.enabled,
      gamification: cfg.integrations.gamification.enabled,
    };
  }
}
