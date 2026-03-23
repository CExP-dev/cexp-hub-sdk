import type { IntegrationToggles } from "../types";
import type { HubContext, Plugin } from "../plugins/types";

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

  constructor(args: { ctx: HubContext; plugins: Map<string, Plugin>; _toggles?: IntegrationToggles }) {
    this.ctx = args.ctx;
    this.plugins = args.plugins;
  }

  track(_event: string, _props?: Record<string, unknown>): void {
    // TODO Task 5+: implement routing rules + delegation.
  }

  page(_props?: Record<string, unknown>): void {
    // TODO Task 5+: implement routing rules + delegation.
  }

  identify(_userId: string, _traits?: Record<string, unknown>): void {
    // TODO Task 5+: implement routing rules + delegation.
  }
}

