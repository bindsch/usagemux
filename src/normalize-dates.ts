/** Timestamp handling: shared date normalization plus the subscription
 * renewal and expiry fallbacks. */
import type { JsonObject } from "./normalize-readers";
import {
  isPlainObject,
  readOptionalString,
  requireObject,
} from "./normalize-readers";

export function normalizeDate(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be an ISO timestamp or null.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${path} must be a valid ISO timestamp or null.`);
  }
  return new Date(timestamp).toISOString();
}

export function resolveSubscriptionDate(
  record: JsonObject,
  usage: JsonObject | null,
  key: "subscriptionRenewsAt" | "subscriptionExpiresAt",
): string | null {
  const explicitValue = usage?.[key] ?? record[key];
  const value = explicitValue ?? (
    key === "subscriptionRenewsAt"
      ? resolveRenewalWindowDate(usage)
      : undefined
  );
  return normalizeDate(value, key);
}

function resolveRenewalWindowDate(usage: JsonObject | null): unknown {
  const extraRateWindows = usage?.extraRateWindows;
  if (!Array.isArray(extraRateWindows)) {
    return undefined;
  }
  for (const [index, value] of extraRateWindows.entries()) {
    const path = `usage.extraRateWindows[${index}]`;
    const namedWindow = requireObject(value, path);
    if (readOptionalString(namedWindow, "id", `${path}.id`) !== "renewal") {
      continue;
    }
    if (!isPlainObject(namedWindow.window)) {
      // A renewal entry without a usable window is treated as absent.
      continue;
    }
    const window = namedWindow.window;
    // Same resetsAt/resetAt precedence as quota windows: an explicit null
    // resetsAt does not fall back to resetAt.
    return window.resetsAt === undefined ? window.resetAt : window.resetsAt;
  }
  return undefined;
}
