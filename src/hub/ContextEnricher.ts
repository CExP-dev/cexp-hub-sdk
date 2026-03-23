export type ContextEnrichment = {
  pageUrl: string;
  path: string;
  referrer: string;
  locale: string;
  userAgent: string;
  timestamp: number;
};

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

/**
 * Models runtime merge policy:
 * - Enricher provides defaults for `ContextEnrichment` keys.
 * - If the user supplies the same keys, the user values win (explicit user keys are never overwritten).
 *
 * Additionally models "presence":
 * - If a key is required in `UserProps`, the return type uses the user-provided type.
 * - If a key is optional in `UserProps`, the return type becomes `default | user` since the key may be absent at runtime.
 */
type MergeContextEnrichment<UserProps extends Record<string, unknown>> = {
  [K in keyof ContextEnrichment]: K extends keyof UserProps
    ? K extends RequiredKeys<UserProps>
      ? UserProps[K]
      : ContextEnrichment[K] | UserProps[K]
    : ContextEnrichment[K];
} & Omit<UserProps, keyof ContextEnrichment>;

/**
 * Enriches a user-provided payload with runtime context (URL/referrer/device/ts).
 *
 * Merge policy:
 * - Enricher provides defaults for `ContextEnrichment` keys.
 * - If the user supplies the same keys, the user values win (explicit user keys are never overwritten).
 */
export class ContextEnricher {
  enrich<UserProps extends Record<string, unknown> = {}>(
    userProps?: UserProps,
  ): MergeContextEnrichment<UserProps> {
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

    return { ...enriched, ...(userProps ?? {}) } as MergeContextEnrichment<UserProps>;
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

