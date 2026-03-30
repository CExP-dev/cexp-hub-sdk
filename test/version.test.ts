import { describe, it, expect, vi } from "vitest";

describe("CExP.version", () => {
  it("is derived from package.json", async () => {
    vi.resetModules();
    vi.doMock("../package.json", () => ({ default: { version: "9.9.9" } }));

    const mod = await import("../src/index");
    expect(mod.CExP.version).toBe("9.9.9");

    vi.unmock("../package.json");
  });
});

