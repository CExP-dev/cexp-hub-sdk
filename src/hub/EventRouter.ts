import type { HubContext, Plugin } from "../plugins/types";

export class EventRouter {
  private readonly ctx: HubContext;
  private readonly plugins: Map<string, Plugin>;

  constructor(args: { ctx: HubContext; plugins: Map<string, Plugin> }) {
    this.ctx = args.ctx;
    this.plugins = args.plugins;
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (t.notification) this.plugins.get("notification")?.identify?.(userId, traits);
    if (t.gamification) this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  reset(): void {
    const t = this.ctx.getToggles();
    if (t.notification) this.plugins.get("notification")?.reset?.();
  }
}
