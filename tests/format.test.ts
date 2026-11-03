import { describe, expect, test } from "bun:test";

import { escapeForTerminal, formatSnapshotText } from "../src/format";
import type { UsageResult, UsageSnapshot } from "../src/types";

const ESC = String.fromCharCode(0x1b);

function result(overrides: Partial<UsageResult> = {}): UsageResult {
  return {
    client: "claude",
    provider: "claude",
    status: "ok",
    source: "codexbar",
    plan: null,
    account: null,
    windows: [],
    credits: null,
    subscriptionRenewsAt: null,
    subscriptionExpiresAt: null,
    message: null,
    ...overrides,
  };
}

function snapshot(results: UsageResult[]): UsageSnapshot {
  return {
    schemaVersion: "1",
    generatedAt: "2026-08-13T10:00:00.000Z",
    results,
  };
}

describe("escapeForTerminal", () => {
  test("escapes C0 control characters", () => {
    expect(escapeForTerminal(`${ESC}[2J`)).toBe("\\x1b[2J");
  });

  test("escapes DEL and C1 control characters", () => {
    expect(escapeForTerminal(`a${String.fromCharCode(0x7f)}b`)).toBe("a\\x7fb");
    expect(escapeForTerminal(String.fromCharCode(0x9b))).toBe("\\x9b");
  });

  test("leaves printable text untouched", () => {
    expect(escapeForTerminal("Pro plan (user@example.com)")).toBe(
      "Pro plan (user@example.com)",
    );
  });
});

describe("formatSnapshotText", () => {
  test("escapes provider-controlled plan and account fields", () => {
    const text = formatSnapshotText(
      snapshot([result({ plan: `${ESC}[2JPro`, account: `${ESC}]0;title` })]),
    );
    expect(text).not.toContain(ESC);
    expect(text).toContain("\\x1b[2JPro");
    expect(text).toContain("\\x1b]0;title");
  });

  test("escapes window kind, credit unit, and error messages", () => {
    const windows = formatSnapshotText(
      snapshot([
        result({
          windows: [
            {
              kind: `${ESC}[31mprimary`,
              usedPercent: 10,
              remainingPercent: 90,
              windowMinutes: null,
              resetsAt: null,
              placeholder: false,
            },
          ],
          credits: { remaining: 5, unit: `${ESC}[0mcredits` },
        }),
      ]),
    );
    expect(windows).not.toContain(ESC);

    const failed = formatSnapshotText(
      snapshot([result({ status: "error", message: `${ESC}[2Jboom` })]),
    );
    expect(failed).not.toContain(ESC);
  });

  test("rounds numbers to at most two decimals without trailing zeros", () => {
    const window = (kind: string, remainingPercent: number) => ({
      kind,
      usedPercent: 100 - remainingPercent,
      remainingPercent,
      windowMinutes: null,
      resetsAt: null,
      placeholder: false,
    });
    const text = formatSnapshotText(
      snapshot([
        result({
          windows: [
            window("primary", 83.565657),
            window("secondary", 33.456),
            window("monthly", 95.5),
            window("daily", 66),
          ],
          credits: { remaining: 17.456, unit: "USD" },
        }),
      ]),
    );

    expect(text).toContain("primary: 83.57% remaining");
    expect(text).toContain("secondary: 33.46% remaining");
    expect(text).toContain("monthly: 95.5% remaining");
    expect(text).toContain("daily: 66% remaining");
    expect(text).toContain("credits: 17.46 USD remaining");
  });

  test("renders unknown remaining and both subscription dates", () => {
    const text = formatSnapshotText(
      snapshot([
        result({
          windows: [
            {
              kind: "primary",
              usedPercent: null,
              remainingPercent: null,
              windowMinutes: 300,
              resetsAt: null,
              placeholder: true,
            },
          ],
          subscriptionRenewsAt: "2026-09-03T10:00:00.000Z",
          subscriptionExpiresAt: "2027-08-03T10:00:00.000Z",
        }),
      ]),
    );

    expect(text).toContain("primary: unknown remaining; reset unknown");
    expect(text).toContain("subscription renews: 2026-09-03T10:00:00.000Z");
    expect(text).toContain("subscription expires: 2027-08-03T10:00:00.000Z");
  });
});
