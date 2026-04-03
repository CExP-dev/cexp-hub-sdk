import type { HubContext, Plugin } from "../plugins/types";

/**
 * Delegates public analytics calls to enabled OneSignal and gamification plugins.
 */
export class EventRouter {
  private readonly ctx: HubContext;
  private readonly plugins: Map<string, Plugin>;

  constructor(args: { ctx: HubContext; plugins: Map<string, Plugin> }) {
    this.ctx = args.ctx;
    this.plugins = args.plugins;
  }

  track(event: string, props?: Record<string, unknown>): void {
    if (this.ctx.getToggles().gamification) {
      this.plugins.get("gamification")?.track?.(event, props ?? {});
    }
  }

  page(props?: Record<string, unknown>): void {
    if (this.ctx.getToggles().gamification) {
      this.plugins.get("gamification")?.page?.(props ?? {});
    }
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (t.onesignal) this.plugins.get("onesignal")?.identify?.(userId, traits);
    if (t.gamification) this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  reset(): void {
    const t = this.ctx.getToggles();
    if (t.onesignal) this.plugins.get("onesignal")?.reset?.();
    if (t.gamification) this.plugins.get("gamification")?.reset?.();
  }
}
