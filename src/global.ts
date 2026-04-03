import type { CExPApi, InitOptions } from "./types";
import { ControlService } from "./hub/ControlService";
import { EventRouter } from "./hub/EventRouter";
import { Hub } from "./hub/Hub";
import { OneSignalPlugin } from "./plugins/onesignal/OneSignalPlugin";
import { GamificationPlugin } from "./plugins/gamification/GamificationPlugin";

import packageJson from "../package.json";

const DEFAULT_VERSION =
  (packageJson as { version?: string }).version ?? "0.0.0";

export function createCExP(): CExPApi {
  let initialized = false;
  let initId: string | undefined;
  let hub: Hub | undefined;
  let router: EventRouter | undefined;
  let controlService: ControlService | undefined;
  let firstConfigResolved = false;
  const preInitQueue: Array<
    | { type: "track"; event: string; props: Record<string, unknown> }
    | { type: "page"; props: Record<string, unknown> }
    | { type: "identify"; userId: string; traits?: Record<string, unknown> }
  > = [];

  const requireInit = (methodName: string) => {
    // Ensure both `initialized` and the stored `initId` are in sync.
    if (!initialized || !initId) {
      throw new Error(`[CExP] Cannot call '${methodName}' before init({ id })`);
    }
  };

  const enqueueOrRun = (entry: (typeof preInitQueue)[number]) => {
    if (!firstConfigResolved) {
      preInitQueue.push(entry);
      return;
    }

    if (!router || !hub) return;
    if (entry.type === "track") {
      router.track(entry.event, entry.props);
      return;
    }
    if (entry.type === "page") {
      router.page(entry.props);
      return;
    }
    router.identify(entry.userId, entry.traits);
  };

  const api: CExPApi = {
    version: DEFAULT_VERSION,

    init: (options: InitOptions) => {
      if (!options?.id) {
        throw new Error("[CExP] init({ id }) is required");
      }
      if (initialized) return;

      hub = new Hub({
        pluginOverrides: {
          onesignal: new OneSignalPlugin(),
          gamification: new GamificationPlugin(),
        },
      });
      router = new EventRouter({
        ctx: hub.getContext(),
        plugins: hub.getPlugins(),
      });

      let applyConfigChain: Promise<void> = Promise.resolve();
      const applyConfig = async () => {
        applyConfigChain = applyConfigChain
          .then(async () => {
            if (!controlService || !hub || !router) return;

            const config = controlService.getConfig();
            if (!config) return;

            await hub.setControlConfig(config);
          })
          .catch(() => {
            // Keep config application chain alive on transient failures.
          });

        return applyConfigChain;
      };

      controlService = new ControlService({
        sdkId: options.id,
        onUpdate: () => {
          void applyConfig();
        },
      });

      initialized = true;
      initId = options.id;
      void (async () => {
        await controlService.syncOnce();
        await applyConfig();
        firstConfigResolved = true;

        // Flush in call order through normal routing pipeline.
        while (preInitQueue.length > 0) {
          const next = preInitQueue.shift();
          if (!next) break;
          enqueueOrRun(next);
        }

        controlService?.startPolling(300_000);
      })();
    },

    track: (event: unknown, props?: Record<string, unknown>) => {
      requireInit("track");
      const eventName = typeof event === "string" ? event : "unknown_event";
      enqueueOrRun({ type: "track", event: eventName, props: props ?? {} });
    },

    page: (page?: unknown) => {
      requireInit("page");
      const props = (
        typeof page === "object" && page !== null ? page : {}
      ) as Record<string, unknown>;
      enqueueOrRun({ type: "page", props });
    },

    identify: (identity: unknown, traits?: Record<string, unknown>) => {
      requireInit("identify");
      if (typeof identity !== "string" || identity.length === 0) return;
      enqueueOrRun({ type: "identify", userId: identity, traits });
    },

    reset: () => {
      requireInit("reset");
      router?.reset();
      controlService?.stopPolling();
      initialized = false;
      firstConfigResolved = false;
      preInitQueue.splice(0, preInitQueue.length);
      initId = undefined;
      hub = undefined;
      router = undefined;
      controlService = undefined;
    },
  };

  return api;
}
