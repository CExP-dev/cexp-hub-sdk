import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Hub } from "../src/hub/Hub";

describe("Hub + SPA page view", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enableSpaPageView forwards debounced SPA navigations to the callback", () => {
    const onPage = vi.fn();

    const hub = new Hub();

    hub.setToggles({
      onesignal: false,
      gamification: false,
    });

    hub.enableSpaPageView(onPage, 60);
    window.history.pushState({}, "", "/hub-spa");
    vi.advanceTimersByTime(60);

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage.mock.calls[0][0]).toMatchObject({ path: "/hub-spa", source: "spa" });

    hub.disableSpaPageView();
  });

  it("notifySpaExplicitPage suppresses the next debounced SPA page", () => {
    const onPage = vi.fn();

    const hub = new Hub();

    hub.setToggles({
      onesignal: false,
      gamification: false,
    });

    hub.enableSpaPageView(onPage, 50);
    hub.notifySpaExplicitPage();
    window.history.pushState({}, "", "/explicit");
    vi.advanceTimersByTime(50);

    expect(onPage).not.toHaveBeenCalled();

    hub.disableSpaPageView();
  });
});
