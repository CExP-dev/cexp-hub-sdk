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

  identifyNotification(userId: string): void {
    const t = this.ctx.getToggles();
    if (!t.notification) return;
    this.plugins.get("notification")?.identify?.(userId);
  }

  identifyGamification(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (!t.gamification) return;
    this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  reset(): void {
    const t = this.ctx.getToggles();
    if (t.notification) this.plugins.get("notification")?.reset?.();
  }

  resetNotification(): void {
    const t = this.ctx.getToggles();
    if (!t.notification) return;
    this.plugins.get("notification")?.reset?.();
  }

  resetGamification(): void {
    const t = this.ctx.getToggles();
    if (!t.gamification) return;
    this.plugins.get("gamification")?.reset?.();
  }
}
