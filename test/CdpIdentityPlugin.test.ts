import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { IdentityStore } from "../src/hub/IdentityStore";

const CDP_JS_URL = "https://octopus-stream01-cads.fpt.vn/cdp.js";

function clearCookie(name: string): void {
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
}

describe("CdpIdentityPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    window.localStorage.clear();
    clearCookie("fpt_uuid");
    clearCookie(IdentityStore.cexpFptUuidKey);
    delete (window as any).cdpFpt;
    document.querySelectorAll(`script[src="${CDP_JS_URL}"]`).forEach((n) => n.remove());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("lazy-loads cdp.js once on onToggle(true) and persists cexp_fpt_uuid", async () => {
    const { CdpIdentityPlugin } = await import("../src/plugins/identity/CdpIdentityPlugin");

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
    const p = (plugin as any).syncPromise as Promise<void>;
    plugin.onToggle(true);
    plugin.onToggle(false);
    plugin.onToggle(true);

    // Wait for the plugin's async handler spawned from `onToggle(true)`.
    await p;

    // Injection once per module/runtime; subsequent toggles should not add scripts again.
    expect(appendSpy).toHaveBeenCalledTimes(1);

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${cdpuuid}`);
  });

  it("does not hang when an existing cdp.js script lacks marker", async () => {
    vi.useFakeTimers();

    const { CdpIdentityPlugin, CDP_SCRIPT_LOAD_TIMEOUT_MS } = await import(
      "../src/plugins/identity/CdpIdentityPlugin"
    );

    const cdpuuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const existing = document.createElement("script");
    existing.setAttribute("src", CDP_JS_URL);
    // Intentionally omit `data-cexp-cdp-loaded="true"`.
    document.head.appendChild(existing);

    const plugin = new CdpIdentityPlugin();
    plugin.onToggle(true);
    const p = (plugin as any).syncPromise as Promise<void>;

    // `cdpFpt` appears after the script-load timeout would have rejected.
    setTimeout(() => {
      (window as any).cdpFpt = {
        getFptUuid: vi.fn(() => cdpuuid),
      };
    }, CDP_SCRIPT_LOAD_TIMEOUT_MS + 100);

    await vi.advanceTimersByTimeAsync(CDP_SCRIPT_LOAD_TIMEOUT_MS + 500);
    await p;

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${cdpuuid}`);
  });

  it("persists cdp-provided uuid even when window.cdpFpt initializes after script.onload", async () => {
    vi.useFakeTimers();

    const { CdpIdentityPlugin, CDP_FPT_READY_TIMEOUT_MS } = await import(
      "../src/plugins/identity/CdpIdentityPlugin"
    );

    const cdpuuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const appendSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
      if (node && typeof node.onload === "function") {
        // Simulate successful script load.
        node.onload(new Event("load"));
      }
      return node;
    });

    const plugin = new CdpIdentityPlugin();
    plugin.onToggle(true);
    const p = (plugin as any).syncPromise as Promise<void>;

    // `cdpFpt` becomes ready shortly after `script.onload`.
    setTimeout(() => {
      (window as any).cdpFpt = {
        getFptUuid: vi.fn(() => cdpuuid),
      };
    }, 100);

    await vi.advanceTimersByTimeAsync(CDP_FPT_READY_TIMEOUT_MS);
    await p;

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${cdpuuid}`);
  });
});

