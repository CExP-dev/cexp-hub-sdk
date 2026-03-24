import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSpaPageView, DEFAULT_SPA_PAGE_DEBOUNCE_MS } from "../src/hub/SpaPageView";

describe("SpaPageView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes onPage after pushState once debounce elapses", () => {
    const onPage = vi.fn();

    const handle = createSpaPageView({
      debounceMs: DEFAULT_SPA_PAGE_DEBOUNCE_MS,
      onPage,
    });

    window.history.pushState({}, "", "/a");
    expect(onPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEFAULT_SPA_PAGE_DEBOUNCE_MS);

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage.mock.calls[0][0]).toMatchObject({
      path: "/a",
      source: "spa",
    });

    handle.stop();
  });

  it("debounces rapid pushState calls into a single emission", () => {
    const onPage = vi.fn();

    const handle = createSpaPageView({
      debounceMs: DEFAULT_SPA_PAGE_DEBOUNCE_MS,
      onPage,
    });

    window.history.pushState({}, "", "/one");
    vi.advanceTimersByTime(20);
    window.history.pushState({}, "", "/two");
    vi.advanceTimersByTime(20);
    window.history.pushState({}, "", "/three");

    expect(onPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEFAULT_SPA_PAGE_DEBOUNCE_MS);

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage.mock.calls[0][0]).toMatchObject({
      path: "/three",
      source: "spa",
    });

    handle.stop();
  });

  it("fires on popstate", () => {
    const onPage = vi.fn();
    const handle = createSpaPageView({ debounceMs: 50, onPage });

    window.history.pushState({}, "", "/start");
    vi.advanceTimersByTime(50);
    onPage.mockClear();

    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(50);

    expect(onPage).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it("skips the next SPA emission after notifyExplicitPage", () => {
    const onPage = vi.fn();
    const handle = createSpaPageView({ debounceMs: 40, onPage });

    handle.notifyExplicitPage();
    window.history.pushState({}, "", "/dup");
    vi.advanceTimersByTime(40);

    expect(onPage).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/ok");
    vi.advanceTimersByTime(40);

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage.mock.calls[0][0]).toMatchObject({ path: "/ok", source: "spa" });

    handle.stop();
  });
});
