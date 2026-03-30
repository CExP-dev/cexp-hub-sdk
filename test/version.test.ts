import { describe, it, expect, vi } from "vitest";

// Keep Vitest's module-mocking behavior explicit and warning-free.
vi.unmock("../package.json");

describe("CExP.version", () => {
  it("is derived from package.json (not hardcoded)", async () => {
    vi.resetModules();
    vi.doMock("../package.json", () => ({ default: { version: "9.9.9" } }));

    const mod = await import("../src/index");

    expect(mod.CExP.version).toBe("9.9.9");
  });
});