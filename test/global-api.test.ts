import { describe, it, expect } from "vitest";

import { createCExP } from "../src/global";

describe("CExP public surface", () => {
  it("exposes an init function", () => {
    const CExP = createCExP();
    expect(typeof CExP.init).toBe("function");
  });
});

