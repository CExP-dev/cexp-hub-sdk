/**
 * Coerce OneSignal slidedown delay fields from backend JSON (number or numeric string)
 * to finite numbers for `OneSignal.init`.
 */
export function coerceNumericDelayValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

/**
 * Deep-clone notification `property` and normalize `promptOptions.slidedown.prompts[].delay`
 * for OneSignal Web v16 `init`.
 */
export function normalizeNotificationPropertyForInit(
  property: Record<string, unknown>,
): Record<string, unknown> {
  let cloned: Record<string, unknown>;
  try {
    cloned = JSON.parse(JSON.stringify(property)) as Record<string, unknown>;
  } catch {
    cloned = { ...property };
  }

  const po = cloned.promptOptions;
  if (!isPlainObject(po)) return cloned;

  const slidedown = po.slidedown;
  if (!isPlainObject(slidedown)) return cloned;

  const prompts = slidedown.prompts;
  if (!Array.isArray(prompts)) return cloned;

  for (const p of prompts) {
    if (!isPlainObject(p)) continue;
    const delay = p.delay;
    if (!isPlainObject(delay)) continue;

    const pv = coerceNumericDelayValue(delay.pageViews);
    const td = coerceNumericDelayValue(delay.timeDelay);

    if (pv === undefined) delete delay.pageViews;
    else delay.pageViews = pv;

    if (td === undefined) delete delay.timeDelay;
    else delay.timeDelay = td;

    if (Object.keys(delay).length === 0) {
      delete p.delay;
    }
  }

  return cloned;
}
