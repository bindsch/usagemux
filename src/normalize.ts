import type { Client } from "./clients";
import type { UsageCredits, UsageResult, UsageWindow } from "./types";

interface NormalizationContext {
  client: Client;
  provider: string;
}

type JsonObject = Record<string, unknown>;

const NAMED_WINDOW_KEYS = ["primary", "secondary", "tertiary"] as const;
const WINDOW_ARRAY_KEYS = ["windows", "additionalWindows", "additional"] as const;

export function normalizeCodexBarPayload(
  payload: unknown,
  context: NormalizationContext,
): UsageResult {
  const record = selectProviderRecord(payload, context.provider);
  const usage = readOptionalObject(record, "usage", "usage");
  const source = resolveSource(record, usage);
  const error = resolveProviderError(record);

  if (error !== null) {
    return emptyResult(context, "error", error, source);
  }

  const windows = collectWindows(record, usage);

  return {
    client: context.client,
    provider: context.provider,
    status: "ok",
    source,
    plan: resolvePlan(record, usage),
    account: resolveAccount(record, usage),
    windows,
    credits: normalizeCredits(record.credits),
    subscriptionRenewsAt: resolveSubscriptionDate(
      record,
      usage,
      "subscriptionRenewsAt",
    ),
    subscriptionExpiresAt: resolveSubscriptionDate(
      record,
      usage,
      "subscriptionExpiresAt",
    ),
    message: null,
  };
}

function selectProviderRecord(payload: unknown, provider: string): JsonObject {
  if (isPlainObject(payload)) {
    validateProvider(payload, provider);
    return payload;
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("CodexBar payload must be an object or non-empty array.");
  }

  const objects = payload.map((value, index) =>
    requireObject(value, `payload[${index}]`),
  );
  const match = objects.find((record) => record.provider === provider);
  if (match) {
    return match;
  }
  if (objects.length === 1) {
    validateProvider(objects[0]!, provider);
    return objects[0]!;
  }
  throw new Error(`CodexBar payload has no result for provider "${provider}".`);
}

function collectWindows(
  record: JsonObject,
  usage: JsonObject | null,
): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const containers = [
    { value: usage, path: "usage" },
    { value: record, path: "payload" },
  ];

  for (const key of NAMED_WINDOW_KEYS) {
    const located = containers.find(
      ({ value }) =>
        value !== null && value[key] !== undefined && value[key] !== null,
    );
    if (located?.value) {
      const windowPath = `${located.path}.${key}`;
      if (isSyntheticPlaceholder(located.value[key], windowPath)) {
        continue;
      }
      windows.push(
        normalizeWindow(located.value[key], key, windowPath),
      );
    }
  }

  for (const { value, path } of containers) {
    if (value === null) {
      continue;
    }
    for (const key of WINDOW_ARRAY_KEYS) {
      const candidate = value[key];
      if (candidate === undefined || candidate === null) {
        continue;
      }
      if (!Array.isArray(candidate)) {
        throw new Error(`${path}.${key} must be an array or null.`);
      }
      for (const [index, rawWindow] of candidate.entries()) {
        const windowPath = `${path}.${key}[${index}]`;
        const windowRecord = requireObject(rawWindow, windowPath);
        if (isSyntheticPlaceholder(windowRecord, windowPath)) {
          continue;
        }
        const kind = readOptionalString(windowRecord, "kind", `${windowPath}.kind`);
        windows.push(
          normalizeWindow(rawWindow, kind ?? `${key}-${index + 1}`, windowPath),
        );
      }
    }
  }

  if (usage?.extraRateWindows !== undefined && usage.extraRateWindows !== null) {
    if (!Array.isArray(usage.extraRateWindows)) {
      throw new Error("usage.extraRateWindows must be an array or null.");
    }
    for (const [index, value] of usage.extraRateWindows.entries()) {
      const path = `usage.extraRateWindows[${index}]`;
      const namedWindow = requireObject(value, path);
      const id = readOptionalString(namedWindow, "id", `${path}.id`);
      const title = readOptionalString(namedWindow, "title", `${path}.title`);
      if (id === "renewal") {
        continue;
      }
      const usageKnown = readOptionalBoolean(
        namedWindow,
        "usageKnown",
        `${path}.usageKnown`,
      );
      if (isSyntheticPlaceholder(namedWindow.window, `${path}.window`)) {
        continue;
      }
      windows.push(normalizeWindow(
        namedWindow.window,
        id ?? title ?? `extra-${index + 1}`,
        `${path}.window`,
        usageKnown === false,
      ));
    }
  }

  return windows;
}

function normalizeWindow(
  value: unknown,
  fallbackKind: string,
  path: string,
  usageUnknown = false,
): UsageWindow {
  const record = requireObject(value, path);
  const used = readOptionalNumber(record, "usedPercent", `${path}.usedPercent`);
  const explicitRemaining = readOptionalNumber(
    record,
    "remainingPercent",
    `${path}.remainingPercent`,
  );
  const remaining = usageUnknown
    ? null
    : explicitRemaining === null
      ? used === null
        ? null
        : clampPercent(100 - used)
      : clampPercent(explicitRemaining);
  const resetValue =
    record.resetsAt === undefined ? record.resetAt : record.resetsAt;

  return {
    kind: readOptionalString(record, "kind", `${path}.kind`) ?? fallbackKind,
    usedPercent: usageUnknown || used === null ? null : clampPercent(used),
    remainingPercent: remaining,
    windowMinutes: readOptionalNumber(
      record,
      "windowMinutes",
      `${path}.windowMinutes`,
    ),
    resetsAt: normalizeDate(resetValue, `${path}.resetsAt`),
  };
}

function normalizeCredits(value: unknown): UsageCredits | null {
  if (value === undefined || value === null) {
    return null;
  }

  const record = requireObject(value, "credits");
  const remaining = readRequiredNumber(record, "remaining", "credits.remaining");
  const unit = readOptionalString(record, "unit", "credits.unit") ?? "credits";
  return { remaining, unit };
}

function resolvePlan(
  record: JsonObject,
  usage: JsonObject | null,
): string | null {
  const identity = usage
    ? readOptionalObject(usage, "identity", "usage.identity")
    : null;
  const dashboard = readOptionalObject(
    record,
    "openaiDashboard",
    "openaiDashboard",
  );
  return firstString([
    readOptionalString(record, "plan", "plan"),
    usage ? readOptionalString(usage, "plan", "usage.plan") : null,
    usage
      ? readOptionalString(usage, "loginMethod", "usage.loginMethod")
      : null,
    identity
      ? readOptionalString(
          identity,
          "loginMethod",
          "usage.identity.loginMethod",
        )
      : null,
    dashboard
      ? readOptionalString(
          dashboard,
          "accountPlan",
          "openaiDashboard.accountPlan",
        )
      : null,
  ]);
}

function resolveAccount(
  record: JsonObject,
  usage: JsonObject | null,
): string | null {
  const identity = usage
    ? readOptionalObject(usage, "identity", "usage.identity")
    : null;
  const dashboard = readOptionalObject(
    record,
    "openaiDashboard",
    "openaiDashboard",
  );
  return firstString([
    readOptionalString(record, "account", "account"),
    readOptionalString(record, "accountEmail", "accountEmail"),
    usage
      ? readOptionalString(usage, "accountEmail", "usage.accountEmail")
      : null,
    identity
      ? readOptionalString(
          identity,
          "accountEmail",
          "usage.identity.accountEmail",
        )
      : null,
    usage
      ? readOptionalString(
          usage,
          "accountOrganization",
          "usage.accountOrganization",
        )
      : null,
    identity
      ? readOptionalString(
          identity,
          "accountOrganization",
          "usage.identity.accountOrganization",
        )
      : null,
    dashboard
      ? readOptionalString(
          dashboard,
          "signedInEmail",
          "openaiDashboard.signedInEmail",
        )
      : null,
  ]);
}

function firstString(values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function validateProvider(record: JsonObject, expected: string): void {
  const actual = readOptionalString(record, "provider", "provider");
  if (actual !== null && actual !== expected) {
    throw new Error(
      `CodexBar payload provider "${actual}" does not match "${expected}".`,
    );
  }
}

function emptyResult(
  context: NormalizationContext,
  status: "error",
  message: string,
  source: string,
): UsageResult {
  return {
    client: context.client,
    provider: context.provider,
    status,
    source,
    plan: null,
    account: null,
    windows: [],
    credits: null,
    subscriptionRenewsAt: null,
    subscriptionExpiresAt: null,
    message,
  };
}

function resolveSource(
  record: JsonObject,
  usage: JsonObject | null,
): string {
  return firstString([
    readOptionalString(record, "source", "source"),
    usage ? readOptionalString(usage, "source", "usage.source") : null,
  ]) ?? "codexbar";
}

function resolveProviderError(record: JsonObject): string | null {
  const value = record.error;
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const error = requireObject(value, "error");
  const message = readOptionalString(error, "message", "error.message");
  if (message === null) {
    throw new Error("error.message must be a string.");
  }
  return message;
}

function resolveSubscriptionDate(
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
    const window = requireObject(namedWindow.window, `${path}.window`);
    return window.resetsAt ?? window.resetAt;
  }
  return undefined;
}

function isSyntheticPlaceholder(value: unknown, path: string): boolean {
  const window = requireObject(value, path);
  return readOptionalBoolean(
    window,
    "isSyntheticPlaceholder",
    `${path}.isSyntheticPlaceholder`,
  ) === true;
}

function normalizeDate(value: unknown, path: string): string | null {
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

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function readOptionalObject(
  record: JsonObject,
  key: string,
  path: string,
): JsonObject | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  return requireObject(value, path);
}

function readOptionalNumber(
  record: JsonObject,
  key: string,
  path: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number or null.`);
  }
  return value;
}

function readOptionalBoolean(
  record: JsonObject,
  key: string,
  path: string,
): boolean | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean or null.`);
  }
  return value;
}

function readRequiredNumber(
  record: JsonObject,
  key: string,
  path: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function readOptionalString(
  record: JsonObject,
  key: string,
  path: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string or null.`);
  }
  return value;
}

function requireObject(value: unknown, path: string): JsonObject {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
