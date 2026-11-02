import type { Client } from "./clients";
import type { JsonObject } from "./normalize-readers";
import type { UsageCredits, UsageResult } from "./types";
import { resolveSubscriptionDate } from "./normalize-dates";
import { collectWindows } from "./normalize-windows";
import {
  isPlainObject,
  readNonEmptyString,
  readOptionalObject,
  readOptionalString,
  readRequiredNumber,
  requireObject,
} from "./normalize-readers";

interface NormalizationContext {
  client: Client;
  provider: string;
}

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

function normalizeCredits(value: unknown): UsageCredits | null {
  if (value === undefined || value === null) {
    return null;
  }

  const record = requireObject(value, "credits");
  const remaining = readRequiredNumber(record, "remaining", "credits.remaining");
  const unit = readNonEmptyString(record, "unit", "credits.unit") ?? "credits";
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
