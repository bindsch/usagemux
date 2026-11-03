/** Quota-window collection and normalization: named windows, window
 * arrays, and extra rate windows. */
import type { JsonObject } from "./normalize-readers";
import type { UsageWindow } from "./types";
import { normalizeDate } from "./normalize-dates";
import {
  readNonEmptyString,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  requireObject,
} from "./normalize-readers";

const NAMED_WINDOW_KEYS = ["primary", "secondary", "tertiary"] as const;
const WINDOW_ARRAY_KEYS = ["windows", "additionalWindows", "additional"] as const;

export function collectWindows(
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
        windows.push(
          placeholderWindow(located.value[key], key, windowPath),
        );
      } else {
        windows.push(
          normalizeWindow(located.value[key], key, windowPath),
        );
      }
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
        const kind = readNonEmptyString(windowRecord, "kind", `${windowPath}.kind`) ??
          `${key}-${index + 1}`;
        if (isSyntheticPlaceholder(windowRecord, windowPath)) {
          windows.push(placeholderWindow(windowRecord, kind, windowPath));
          continue;
        }
        windows.push(normalizeWindow(rawWindow, kind, windowPath));
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
      const windowKind = firstNonEmpty(id, title) ?? `extra-${index + 1}`;
      if (isSyntheticPlaceholder(namedWindow.window, `${path}.window`)) {
        windows.push(
          placeholderWindow(namedWindow.window, windowKind, `${path}.window`),
        );
        continue;
      }
      windows.push(normalizeWindow(
        namedWindow.window,
        windowKind,
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
  // Percentages are clamped, then rounded to two decimals at emit, so JSON
  // and text carry identical values. Derived remaining is computed from the
  // rounded used value so the pair stays consistent.
  const usedPercent = usageUnknown || used === null
    ? null
    : roundPercent(clampPercent(used));
  const remaining = usageUnknown
    ? null
    : explicitRemaining === null
      ? usedPercent === null
        ? null
        : roundPercent(clampPercent(100 - usedPercent))
      : roundPercent(clampPercent(explicitRemaining));
  const resetValue =
    record.resetsAt === undefined ? record.resetAt : record.resetsAt;

  return {
    kind: readNonEmptyString(record, "kind", `${path}.kind`) ?? fallbackKind,
    usedPercent,
    remainingPercent: remaining,
    windowMinutes: readWindowMinutes(record, `${path}.windowMinutes`),
    resetsAt: normalizeDate(resetValue, `${path}.resetsAt`),
    placeholder: false,
  };
}

/** A placeholder window is kept, not dropped: its presence says the window
 * exists while its level is unknown, which a consumer cannot learn from an
 * omitted window. Its kind follows the normal fallback labels and both
 * percentages are null even when numbers are present. */
function placeholderWindow(
  value: unknown,
  fallbackKind: string,
  path: string,
): UsageWindow {
  return {
    ...normalizeWindow(value, fallbackKind, path, true),
    placeholder: true,
  };
}

/** An empty `id` or `title` counts as absent, like an empty `kind`, so the
 * documented fallback label applies. */
function firstNonEmpty(...values: (string | null)[]): string | null {
  for (const value of values) {
    if (value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function isSyntheticPlaceholder(value: unknown, path: string): boolean {
  const window = requireObject(value, path);
  return readOptionalBoolean(
    window,
    "isSyntheticPlaceholder",
    `${path}.isSyntheticPlaceholder`,
  ) === true;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function roundPercent(value: number): number {
  return Number(value.toFixed(2));
}

/** A duration is not a level: negative or non-finite upstream values are
 * sentinels or corruption, not measurements, so they are emitted as null
 * instead of passing a value consumers reject. */
function readWindowMinutes(record: JsonObject, path: string): number | null {
  const value = record.windowMinutes;
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new Error(`${path} must be a finite number or null.`);
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}
