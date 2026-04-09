import { describe, it, expect } from "vitest";

import { normalizeNotificationPropertyForInit } from "../src/config/onesignalInitNormalize";

describe("normalizeNotificationPropertyForInit", () => {
  it("coerces delay.pageViews and delay.timeDelay from strings to numbers", () => {
    const input = {
      appId: "x",
      promptOptions: {
        slidedown: {
          prompts: [
            {
              delay: { pageViews: "1", timeDelay: "5" },
            },
          ],
        },
      },
    };
    const out = normalizeNotificationPropertyForInit(input as Record<string, unknown>);
    const prompts = (out.promptOptions as { slidedown: { prompts: Array<{ delay: { pageViews: number; timeDelay: number } }> } })
      .slidedown.prompts;
    expect(prompts[0].delay.pageViews).toBe(1);
    expect(prompts[0].delay.timeDelay).toBe(5);
  });

  it("omits delay keys when coercion fails", () => {
    const input = {
      promptOptions: {
        slidedown: {
          prompts: [{ delay: { pageViews: "nope", timeDelay: 3 } }],
        },
      },
    };
    const out = normalizeNotificationPropertyForInit(input as Record<string, unknown>);
    const delay = (out.promptOptions as { slidedown: { prompts: Array<{ delay: Record<string, unknown> }> } }).slidedown
      .prompts[0].delay;
    expect("pageViews" in delay).toBe(false);
    expect(delay.timeDelay).toBe(3);
  });
});
