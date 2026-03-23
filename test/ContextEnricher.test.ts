import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ContextEnricher } from "../src/hub/ContextEnricher";

describe("ContextEnricher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enriches with pageUrl, path, referrer, locale, userAgent, timestamp", () => {
    Object.defineProperty(window.navigator, "language", { value: "fr-FR", configurable: true });
    Object.defineProperty(window.navigator, "userAgent", { value: "ua-test", configurable: true });
    Object.defineProperty(document, "referrer", { get: () => "https://referrer.example/", configurable: true });

    window.history.pushState({}, "", "/test/path?x=1");

    const nowMs = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);

    const enricher = new ContextEnricher();
    const out = enricher.enrich({ foo: "bar" });

    expect(out.pageUrl).toBe(window.location.href);
    expect(out.path).toBe(window.location.pathname);
    expect(out.referrer).toBe("https://referrer.example/");
    expect(out.locale).toBe("fr-FR");
    expect(out.userAgent).toBe("ua-test");
    expect(out.timestamp).toBe(nowMs);
    expect(out.foo).toBe("bar");
  });

  it("does not overwrite explicit user keys (user wins)", () => {
    Object.defineProperty(window.navigator, "language", { value: "fr-FR", configurable: true });
    Object.defineProperty(window.navigator, "userAgent", { value: "ua-test", configurable: true });
    Object.defineProperty(document, "referrer", { get: () => "https://referrer.example/", configurable: true });

    window.history.pushState({}, "", "/base/path");

    const nowMs = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);

    const enricher = new ContextEnricher();
    const out = enricher.enrich({
      locale: "it-IT",
      timestamp: 123,
      pageUrl: "user-page-url",
      referrer: "user-referrer",
      path: "/user/path",
      userAgent: "user-ua",
      extra: 1,
    });

    // Merge policy: explicit user keys must not be overwritten by enricher.
    expect(out.locale).toBe("it-IT");
    expect(out.timestamp).toBe(123);
    expect(out.pageUrl).toBe("user-page-url");
    expect(out.referrer).toBe("user-referrer");
    expect(out.path).toBe("/user/path");
    expect(out.userAgent).toBe("user-ua");
    expect(out.extra).toBe(1);
  });
});

