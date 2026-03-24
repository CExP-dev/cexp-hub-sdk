export const DEFAULT_SPA_PAGE_DEBOUNCE_MS = 75;

export type SpaPageViewOptions = {
  /**
   * Delay after the last history event before emitting a page view (50–100ms per plan).
   */
  debounceMs?: number;

  /**
   * Called with path + document title after SPA navigation (debounced).
   */
  onPage: (props: Record<string, unknown>) => void;
};

export type SpaPageViewHandle = {
  /**
   * Tear down history hooks and listeners. Safe to call more than once.
   */
  stop: () => void;

  /**
   * Call when the consumer invokes `CExP.page(...)` so the next debounced SPA
   * emission is skipped (avoids duplicate page_view for the same navigation).
   */
  notifyExplicitPage: () => void;
};

type HistoryRestore = () => void;

/**
 * Patches `history.pushState` / `replaceState` once per install and listens to
 * `popstate`. Debounces emissions so rapid transitions collapse to one page view.
 */
export function createSpaPageView(options: SpaPageViewOptions): SpaPageViewHandle {
  const debounceMs = options.debounceMs ?? DEFAULT_SPA_PAGE_DEBOUNCE_MS;
  const { onPage } = options;

  let skipNextSpaEmission = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = () => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    if (skipNextSpaEmission) {
      skipNextSpaEmission = false;
      return;
    }

    onPage({
      path: window.location.pathname,
      title: typeof document.title === "string" ? document.title : "",
      source: "spa",
    });
  };

  const schedule = () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      emit();
    }, debounceMs);
  };

  const notifyExplicitPage = () => {
    skipNextSpaEmission = true;
  };

  let restoreHistory: HistoryRestore | undefined;

  if (typeof window !== "undefined" && typeof history !== "undefined") {
    const w = window as Window & typeof globalThis;
    const h = history;

    const originalPushState = h.pushState;
    const originalReplaceState = h.replaceState;

    h.pushState = function pushStatePatched(...args: Parameters<History["pushState"]>) {
      originalPushState.apply(h, args);
      schedule();
    };

    h.replaceState = function replaceStatePatched(...args: Parameters<History["replaceState"]>) {
      originalReplaceState.apply(h, args);
      schedule();
    };

    const onPopState = () => schedule();
    w.addEventListener("popstate", onPopState);

    restoreHistory = () => {
      h.pushState = originalPushState;
      h.replaceState = originalReplaceState;
      w.removeEventListener("popstate", onPopState);
    };
  }

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }

    restoreHistory?.();
    restoreHistory = undefined;
  };

  return { stop, notifyExplicitPage };
}
