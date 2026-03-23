import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CdpIdentityPlugin } from "../src/plugins/identity/CdpIdentityPlugin";
import { IdentityStore } from "../src/hub/IdentityStore";

function clearCookie(name: string): void {
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
}

describe("CdpIdentityPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    clearCookie("fpt_uuid");
    clearCookie(IdentityStore.cexpFptUuidKey);
    delete (window as any).cdpFpt;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lazy-loads cdp.js once on onToggle(true) and persists cexp_fpt_uuid", async () => {
    const cdpuuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    (window as any).cdpFpt = {
      getFptUuid: vi.fn(() => cdpuuid),
    };

    const appendSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
      if (node && typeof node.onload === "function") {
        // Simulate successful script load.
        node.onload(new Event("load"));
      }
      return node;
    });

    const plugin = new CdpIdentityPlugin();

    plugin.onToggle(true);
    plugin.onToggle(true);
    plugin.onToggle(false);
    plugin.onToggle(true);

    // Wait for the plugin's async handler spawned from `onToggle(true)`.
    await (plugin as any).syncPromise;

    // Injection once per module/runtime; subsequent toggles should not add scripts again.
    expect(appendSpy).toHaveBeenCalledTimes(1);

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${cdpuuid}`);
  });
});

