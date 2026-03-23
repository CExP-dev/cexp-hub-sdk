import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { IdentityStore } from "../src/hub/IdentityStore";

function clearCookie(name: string): void {
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
}

describe("IdentityStore (fpt_uuid)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    clearCookie("fpt_uuid");
    clearCookie(IdentityStore.cexpFptUuidKey);
    // Ensure cdpFpt isn't leaking across tests.
    delete (window as any).cdpFpt;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers window.cdpFpt.getFptUuid() then mirrors to localStorage + cookie", () => {
    const cdpuuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    (window as any).cdpFpt = {
      getFptUuid: vi.fn(() => cdpuuid),
    };

    const resolved = IdentityStore.getOrCreateFptUuid();
    expect(resolved).toBe(cdpuuid);

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${cdpuuid}`);
  });

  it("falls back to window.cdpFpt.fpt_uuid property then mirrors to localStorage + cookie", () => {
    const cdpuuid = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";
    (window as any).cdpFpt = {
      fpt_uuid: cdpuuid,
    };

    const resolved = IdentityStore.getOrCreateFptUuid();
    expect(resolved).toBe(cdpuuid);

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(cdpuuid);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${cdpuuid}`);
  });

  it("uses existing mirrors (localStorage -> cookie) when window.cdpFpt is missing", () => {
    const existing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    window.localStorage.setItem("fpt_uuid", existing);
    // no cookie mirror set

    const resolved = IdentityStore.getOrCreateFptUuid();
    expect(resolved).toBe(existing);

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(existing);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${existing}`);
  });

  it("generates uuid v4 and persists it when nothing exists", () => {
    const resolved = IdentityStore.getOrCreateFptUuid();

    // UUIDv4 regex: version=4 and variant in [8,9,a,b]
    const v4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(resolved).toMatch(v4);

    expect(window.localStorage.getItem(IdentityStore.cexpFptUuidKey)).toBe(resolved);
    expect(document.cookie).toContain(`${IdentityStore.cexpFptUuidKey}=${resolved}`);
  });
});

