import { describe, expect, test } from "bun:test";
import { normalizeCodexBarPayload } from "../src/normalize";

describe("CodexBar contract edges", () => {
  const normalize = (input: unknown) =>
    normalizeCodexBarPayload(input, { client: "codex", provider: "codex" });

  test("array windows fall back to positional kinds and keep placeholders", () => {
    const result = normalize({
      provider: "codex",
      usage: {
        windows: [
          { usedPercent: 10 },
          { kind: "", usedPercent: 20 },
          { usedPercent: 5, isSyntheticPlaceholder: true },
        ],
      },
    });

    expect(result.windows).toEqual([
      expect.objectContaining({
        kind: "windows-1",
        usedPercent: 10,
        placeholder: false,
      }),
      expect.objectContaining({ kind: "windows-2", placeholder: false }),
      {
        kind: "windows-3",
        usedPercent: null,
        remainingPercent: null,
        windowMinutes: null,
        resetsAt: null,
        placeholder: true,
      },
    ]);
  });

  test("extra windows fall back to title, then position, and keep placeholders", () => {
    const result = normalize({
      provider: "codex",
      usage: {
        extraRateWindows: [
          { title: "Weekly cap", window: { usedPercent: 10 } },
          { window: { usedPercent: 20, isSyntheticPlaceholder: true } },
          { window: { usedPercent: 30 } },
        ],
      },
    });

    expect(result.windows.map(({ kind, placeholder }) => ({ kind, placeholder })))
      .toEqual([
        { kind: "Weekly cap", placeholder: false },
        { kind: "extra-2", placeholder: true },
        { kind: "extra-3", placeholder: false },
      ]);
    expect(result.windows[1]).toMatchObject({
      usedPercent: null,
      remainingPercent: null,
    });
  });

  test("extra windows treat an empty id or title as absent", () => {
    const result = normalize({
      provider: "codex",
      usage: {
        extraRateWindows: [
          { id: "", title: "Weekly", window: { kind: "" } },
          { id: "", title: "", window: {} },
        ],
      },
    });

    expect(result.windows.map(({ kind }) => kind)).toEqual([
      "Weekly",
      "extra-2",
    ]);
  });

  test("named windows are read from the top level when usage has none", () => {
    const result = normalize({
      provider: "codex",
      primary: { kind: "", usedPercent: 30 },
    });

    expect(result.windows).toEqual([
      {
        kind: "primary",
        usedPercent: 30,
        remainingPercent: 70,
        windowMinutes: null,
        resetsAt: null,
        placeholder: false,
      },
    ]);
  });

  test("resetsAt takes precedence over resetAt including an explicit null", () => {
    const window = (usage: unknown) => normalize({ provider: "codex", usage }).windows[0];

    expect(window({ primary: { resetsAt: "2026-08-04T10:00:00Z", resetAt: "2026-08-05T10:00:00Z" } })?.resetsAt).toBe(
      "2026-08-04T10:00:00.000Z",
    );
    expect(window({ primary: { resetsAt: null, resetAt: "2026-08-05T10:00:00Z" } })?.resetsAt).toBe(null);
    expect(window({ primary: { resetAt: "2026-08-05T10:00:00Z" } })?.resetsAt).toBe(
      "2026-08-05T10:00:00.000Z",
    );
  });

  test("plan and account reach their later fallback tails", () => {
    expect(normalize({
      provider: "codex",
      usage: { plan: "usage-plan" },
    }).plan).toBe("usage-plan");
    expect(normalize({
      provider: "codex",
      usage: { loginMethod: "api-key" },
    }).plan).toBe("api-key");
    expect(normalize({
      provider: "codex",
      usage: { accountOrganization: "acme" },
    }).account).toBe("acme");
    expect(normalize({
      provider: "codex",
      openaiDashboard: { signedInEmail: "dash@example.com" },
    }).account).toBe("dash@example.com");
  });

  test("clamps out-of-range percentages to 0 and 100", () => {
    const result = normalize({
      provider: "codex",
      usage: {
        primary: { usedPercent: -5 },
        secondary: { usedPercent: 120 },
      },
    });

    expect(result.windows[0]).toMatchObject({
      usedPercent: 0,
      remainingPercent: 100,
    });
    expect(result.windows[1]).toMatchObject({
      usedPercent: 100,
      remainingPercent: 0,
    });
  });

  test("rounds percentages to two decimals at emit", () => {
    const result = normalize({
      provider: "codex",
      usage: {
        primary: { usedPercent: 16.434343 },
        secondary: { usedPercent: 40, remainingPercent: 33.456 },
      },
    });

    expect(result.windows[0]).toMatchObject({
      usedPercent: 16.43,
      remainingPercent: 83.57,
    });
    expect(result.windows[1]).toMatchObject({
      usedPercent: 40,
      remainingPercent: 33.46,
    });
  });

  test("emits null windowMinutes for negative or non-finite durations", () => {
    const result = normalize({
      provider: "codex",
      usage: { primary: { usedPercent: 10, windowMinutes: -5 } },
    });
    expect(result.windows[0]?.windowMinutes).toBe(null);

    const nonFinite = normalize({
      provider: "codex",
      usage: { primary: { usedPercent: 10, windowMinutes: Number.POSITIVE_INFINITY } },
    });
    expect(nonFinite.windows[0]?.windowMinutes).toBe(null);
  });

  test("still rejects a string windowMinutes", () => {
    expect(() =>
      normalize({ provider: "codex", usage: { primary: { windowMinutes: "300" } } }),
    ).toThrow("usage.primary.windowMinutes must be a finite number or null.");
  });

  test("treats an empty credit unit as absent", () => {
    expect(
      normalize({ provider: "codex", credits: { remaining: 1, unit: "" } }).credits,
    ).toEqual({ remaining: 1, unit: "credits" });
  });

  test("a renewal entry without a usable window is treated as absent", () => {
    const result = normalizeCodexBarPayload(
      {
        provider: "opencode",
        usage: { extraRateWindows: [{ id: "renewal", resetsAt: "2026-09-03T10:00:00Z" }] },
      },
      { client: "opencode", provider: "opencode" },
    );

    expect(result.subscriptionRenewsAt).toBe(null);
    expect(result.windows).toEqual([]);
    expect(result.status).toBe("ok");
  });

  test("a renewal window's null resetsAt does not fall back to resetAt", () => {
    const result = normalizeCodexBarPayload(
      {
        provider: "opencode",
        usage: {
          extraRateWindows: [
            { id: "renewal", window: { resetsAt: null, resetAt: "2026-09-03T10:00:00Z" } },
          ],
        },
      },
      { client: "opencode", provider: "opencode" },
    );

    expect(result.subscriptionRenewsAt).toBe(null);
  });

  test("a renewal window without resetsAt still uses resetAt", () => {
    const result = normalizeCodexBarPayload(
      {
        provider: "opencode",
        usage: {
          extraRateWindows: [{ id: "renewal", window: { resetAt: "2026-09-03T10:00:00Z" } }],
        },
      },
      { client: "opencode", provider: "opencode" },
    );

    expect(result.subscriptionRenewsAt).toBe("2026-09-03T10:00:00.000Z");
  });
});
