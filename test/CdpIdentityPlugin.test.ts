import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { IdentityStore } from "../src/hub/IdentityStore";

const CDP_JS_URL = "https://octopus-stream01-cads.fpt.vn/cdp.js";
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  it("completes and persists fallback when injected script errors (node.onerror)", async () => {
    vi.useFakeTimers();

    const { CdpIdentityPlugin, CDP_FPT_READY_TIMEOUT_MS } = await import(
      "../src/plugins/identity/CdpIdentityPlugin"
    );

    const realAppendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
      realAppendChild(node);
      if (node && typeof node.onerror === "function") {
        node.onerror(new Event("error"));
      }
      return node;
    });

    const plugin = new CdpIdentityPlugin();
    plugin.onToggle(true);
    const p = (plugin as any).syncPromise as Promise<void>;

    await vi.advanceTimersByTimeAsync(CDP_FPT_READY_TIMEOUT_MS + 500);
    await p;

    const persisted = window.localStorage.getItem(IdentityStore.cexpFptUuidKey);
    expect(persisted).toBeTruthy();
    expect(persisted).toMatch(uuidRegex);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${persisted}`);
  });

  it("does not hang when injected script never calls onload/onerror (timeout fallback)", async () => {
    vi.useFakeTimers();

    const { CdpIdentityPlugin, CDP_SCRIPT_LOAD_TIMEOUT_MS, CDP_FPT_READY_TIMEOUT_MS } = await import(
      "../src/plugins/identity/CdpIdentityPlugin"
    );

    const realAppendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
      // Insert the element so future enable attempts can find it.
      realAppendChild(node);
      return node;
    });

    const plugin = new CdpIdentityPlugin();
    plugin.onToggle(true);
    const p = (plugin as any).syncPromise as Promise<void>;

    await vi.advanceTimersByTimeAsync(CDP_SCRIPT_LOAD_TIMEOUT_MS + CDP_FPT_READY_TIMEOUT_MS + 1000);
    await p;

    const persisted = window.localStorage.getItem(IdentityStore.cexpFptUuidKey);
    expect(persisted).toBeTruthy();
    expect(persisted).toMatch(uuidRegex);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${persisted}`);
  });

  it("does not late-correct UUID if cdpFpt becomes ready after CDP_FPT_READY_TIMEOUT_MS", async () => {
    vi.useFakeTimers();

    const { CdpIdentityPlugin, CDP_FPT_READY_TIMEOUT_MS } = await import(
      "../src/plugins/identity/CdpIdentityPlugin"
    );

    const cdpuuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const realAppendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
      realAppendChild(node);
      if (node && typeof node.onload === "function") {
        node.onload(new Event("load"));
      }
      return node;
    });

    const plugin = new CdpIdentityPlugin();
    plugin.onToggle(true);
    const p = (plugin as any).syncPromise as Promise<void>;

    // Ensure the UUID fallback gets persisted before `cdpFpt` becomes available.
    setTimeout(() => {
      (window as any).cdpFpt = {
        getFptUuid: vi.fn(() => cdpuuid),
      };
    }, CDP_FPT_READY_TIMEOUT_MS + 1000);

    await vi.advanceTimersByTimeAsync(CDP_FPT_READY_TIMEOUT_MS + 500);
    await p;

    const fallbackUuid = window.localStorage.getItem(IdentityStore.cexpFptUuidKey);
    expect(fallbackUuid).toBeTruthy();
    expect(fallbackUuid).toMatch(uuidRegex);
    expect(fallbackUuid).not.toBe(cdpuuid);

    // Now that `cdpFpt` is available, the persisted value should remain the fallback UUID.
    await vi.advanceTimersByTimeAsync(700);
    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(fallbackUuid);
  });

  it("retries after injected script failure and persists cdp-provided UUID on next enable", async () => {
    vi.useFakeTimers();

    const { CdpIdentityPlugin, CDP_SCRIPT_LOAD_TIMEOUT_MS, CDP_FPT_READY_TIMEOUT_MS } = await import(
      "../src/plugins/identity/CdpIdentityPlugin"
    );

    const cdpuuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const realAppendChild = document.head.appendChild.bind(document.head);
    const appendSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
      realAppendChild(node);
      // Intentionally never call onload/onerror: first enable should fail via timeout.
      return node;
    });

    const plugin = new CdpIdentityPlugin();
    plugin.onToggle(true);
    const p1 = (plugin as any).syncPromise as Promise<void>;

    await vi.advanceTimersByTimeAsync(CDP_SCRIPT_LOAD_TIMEOUT_MS + CDP_FPT_READY_TIMEOUT_MS + 1000);
    await p1;

    const fallbackUuid = window.localStorage.getItem(IdentityStore.cexpFptUuidKey);
    expect(fallbackUuid).toBeTruthy();

    // Retry: after the failure, set `cdpFpt` so the loader can settle via the "existing script" branch.
    (window as any).cdpFpt = {
      getFptUuid: vi.fn(() => cdpuuid),
    };
    plugin.onToggle(false);
    plugin.onToggle(true);

    const p2 = (plugin as any).syncPromise as Promise<void>;
    await p2;

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
  });
});

