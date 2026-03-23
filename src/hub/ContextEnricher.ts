export type ContextEnrichment = {
  pageUrl: string;
  path: string;
  referrer: string;
  locale: string;
  userAgent: string;
  timestamp: number;
};

/**
 * Enriches a user-provided payload with runtime context (URL/referrer/device/ts).
 *
 * Merge policy:
 * - Enricher provides defaults for `ContextEnrichment` keys.
 * - If the user supplies the same keys, the user values win (explicit user keys are never overwritten).
 */
export class ContextEnricher {
  enrich(userProps: Record<string, unknown> = {}): ContextEnrichment & Record<string, unknown> {
    const timestamp = Date.now();

    const pageUrl =
      typeof window !== "undefined" && window.location ? window.location.href : "";
    const path =
      typeof window !== "undefined" && window.location ? window.location.pathname : "";
    const referrer =
      typeof document !== "undefined" && typeof document.referrer === "string" ? document.referrer : "";

    const locale = this.getLocale();
    const userAgent = this.getUserAgent();

    const enriched: ContextEnrichment = {
      pageUrl,
      path,
      referrer,
      locale,
      userAgent,
      timestamp,
    };

    return { ...enriched, ...(userProps ?? {}) };
  }

  private getLocale(): string {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (!nav) return "en";

    // Prefer `navigator.language` since it's commonly set in tests and user agent contexts.
    if (typeof nav.language === "string" && nav.language.length > 0) return nav.language;

    // Fall back to languages[0] if present.
    const langs = nav.languages;
    if (Array.isArray(langs) && langs.length > 0 && typeof langs[0] === "string") return langs[0];
    return "en";
  }

  private getUserAgent(): string {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (!nav) return "";
    return typeof nav.userAgent === "string" ? nav.userAgent : "";
  }
}

