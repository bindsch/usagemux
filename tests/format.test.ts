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
});
