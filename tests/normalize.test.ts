import { describe, expect, test } from "bun:test";

import { normalizeCodexBarPayload } from "../src/normalize";

const payload = {
  provider: "codex",
  plan: "plus",
  account: "laurent@example.com",
  usage: {
    primary: {
      usedPercent: 37,
      windowMinutes: 300,
      resetsAt: "2026-08-03T12:00:00Z",
    },
    secondary: {
      usedPercent: 72.5,
      remainingPercent: 27.5,
      windowMinutes: 10_080,
      resetsAt: null,
    },
    tertiary: {
      remainingPercent: 120,
      windowMinutes: 43_200,
      resetsAt: "2026-09-01T00:00:00Z",
    },
    additionalWindows: [
      {
        kind: "monthly",
        usedPercent: 10,
        windowMinutes: 43_200,
        resetsAt: "2026-09-02T00:00:00Z",
      },
    ],
  },
  credits: { remaining: 17.5, unit: "USD" },
};

describe("CodexBar normalization", () => {
  test("normalizes an object payload and derives remaining usage", () => {
    expect(
      normalizeCodexBarPayload(payload, {
        client: "codex",
        provider: "codex",
      }),
    ).toEqual({
      client: "codex",
      provider: "codex",
      status: "ok",
      source: "codexbar",
      plan: "plus",
      account: "laurent@example.com",
      windows: [
        {
          kind: "primary",
          usedPercent: 37,
          remainingPercent: 63,
          windowMinutes: 300,
          resetsAt: "2026-08-03T12:00:00.000Z",
          placeholder: false,
        },
        {
          kind: "secondary",
          usedPercent: 72.5,
          remainingPercent: 27.5,
          windowMinutes: 10_080,
          resetsAt: null,
          placeholder: false,
        },
        {
          kind: "tertiary",
          usedPercent: null,
          remainingPercent: 100,
          windowMinutes: 43_200,
          resetsAt: "2026-09-01T00:00:00.000Z",
          placeholder: false,
        },
        {
          kind: "monthly",
          usedPercent: 10,
          remainingPercent: 90,
          windowMinutes: 43_200,
          resetsAt: "2026-09-02T00:00:00.000Z",
          placeholder: false,
        },
      ],
      credits: { remaining: 17.5, unit: "USD" },
      subscriptionRenewsAt: null,
      subscriptionExpiresAt: null,
      message: null,
    });
  });

  test("accepts a one-element array payload", () => {
    expect(
      normalizeCodexBarPayload([payload], {
        client: "codex",
        provider: "codex",
      }).status,
    ).toBe("ok");
  });

  test("normalizes null windows and current CodexBar account metadata", () => {
    const result = normalizeCodexBarPayload(
      [
        {
          provider: "codex",
          usage: {
            primary: null,
            secondary: { usedPercent: 41, windowMinutes: 10_080 },
            tertiary: null,
            accountEmail: "laurent@example.com",
          },
          openaiDashboard: { accountPlan: "plus" },
          credits: { remaining: 12.5 },
        },
      ],
      { client: "codex", provider: "codex" },
    );

    expect(result).toMatchObject({
      status: "ok",
      plan: "plus",
      account: "laurent@example.com",
      credits: { remaining: 12.5, unit: "credits" },
      windows: [
        {
          kind: "secondary",
          usedPercent: 41,
          remainingPercent: 59,
        },
      ],
    });
  });

  test("preserves current CodexBar source, identity plan, renewal, and extra windows", () => {
    const result = normalizeCodexBarPayload(
      [{
        provider: "codex",
        source: "openai-web",
        usage: {
          primary: null,
          secondary: null,
          tertiary: null,
          subscriptionRenewsAt: "2026-09-03T10:00:00Z",
          subscriptionExpiresAt: "2027-08-03T10:00:00Z",
          identity: {
            providerID: "codex",
            accountEmail: "laurent@example.com",
            loginMethod: "pro",
          },
          extraRateWindows: [{
            id: "code-review-weekly",
            title: "Code review weekly",
            usageKnown: false,
            window: {
              usedPercent: 84,
              windowMinutes: 10_080,
              resetsAt: "2026-08-08T09:48:42Z",
            },
          }],
        },
      }],
      { client: "codex", provider: "codex" },
    );

    expect(result).toMatchObject({
      source: "openai-web",
      plan: "pro",
      account: "laurent@example.com",
      subscriptionRenewsAt: "2026-09-03T10:00:00.000Z",
      subscriptionExpiresAt: "2027-08-03T10:00:00.000Z",
      windows: [{
        kind: "code-review-weekly",
        usedPercent: null,
        remainingPercent: null,
        windowMinutes: 10_080,
        resetsAt: "2026-08-08T09:48:42.000Z",
      }],
    });
  });

  test("normalizes CodexBar structured provider errors", () => {
    expect(normalizeCodexBarPayload(
      [{
        provider: "codex",
        source: "codex-cli",
        error: { code: 1, message: "authentication required", kind: "provider" },
      }],
      { client: "codex", provider: "codex" },
    )).toMatchObject({
      status: "error",
      source: "codex-cli",
      message: "authentication required",
      subscriptionRenewsAt: null,
      subscriptionExpiresAt: null,
    });
  });

  test("maps OpenCode renewal windows to subscription metadata", () => {
    const result = normalizeCodexBarPayload({
      provider: "opencode",
      source: "oauth",
      usage: {
        primary: null,
        secondary: null,
        tertiary: null,
        extraRateWindows: [{
          id: "renewal",
          title: "Renews",
          window: {
            usedPercent: 0,
            windowMinutes: null,
            resetsAt: "2026-09-03T10:00:00Z",
          },
        }],
      },
    }, { client: "opencode", provider: "opencode" });

    expect(result).toMatchObject({
      subscriptionRenewsAt: "2026-09-03T10:00:00.000Z",
      windows: [],
    });
  });

  test("keeps a Claude synthetic placeholder window with null percents", () => {
    const result = normalizeCodexBarPayload({
      provider: "claude",
      source: "web",
      usage: {
        primary: {
          usedPercent: 0,
          windowMinutes: 300,
          resetsAt: null,
          isSyntheticPlaceholder: true,
        },
        secondary: {
          usedPercent: 42,
          windowMinutes: 10_080,
          resetsAt: "2026-08-08T09:48:42Z",
        },
      },
    }, { client: "claude", provider: "claude" });

    expect(result.windows).toEqual([
      {
        kind: "primary",
        usedPercent: null,
        remainingPercent: null,
        windowMinutes: 300,
        resetsAt: null,
        placeholder: true,
      },
      expect.objectContaining({
        kind: "secondary",
        usedPercent: 42,
        remainingPercent: 58,
        placeholder: false,
      }),
    ]);
  });

  test("selects the requested provider from an array payload", () => {
    const result = normalizeCodexBarPayload(
      [{ provider: "claude", error: "wrong provider" }, payload],
      { client: "codex", provider: "codex" },
    );

    expect(result.status).toBe("ok");
  });

  test("normalizes a provider-reported error", () => {
    expect(
      normalizeCodexBarPayload(
        { provider: "codex", error: "rate limited" },
        { client: "codex", provider: "codex" },
      ),
    ).toMatchObject({
      client: "codex",
      provider: "codex",
      status: "error",
      source: "codexbar",
      windows: [],
      credits: null,
      message: "rate limited",
    });
  });

  test("rejects malformed payloads descriptively", () => {
    expect(() =>
      normalizeCodexBarPayload("nope", {
        client: "codex",
        provider: "codex",
      }),
    ).toThrow("CodexBar payload must be an object or non-empty array");

    expect(() =>
      normalizeCodexBarPayload([], { client: "codex", provider: "codex" }),
    ).toThrow("CodexBar payload must be an object or non-empty array");

    expect(() =>
      normalizeCodexBarPayload(
        [{ provider: "claude" }, { provider: "zai" }],
        { client: "codex", provider: "codex" },
      ),
    ).toThrow('CodexBar payload has no result for provider "codex"');

    expect(() =>
      normalizeCodexBarPayload(
        [{ provider: "claude", usage: {} }],
        { client: "codex", provider: "codex" },
      ),
    ).toThrow('CodexBar payload provider "claude" does not match "codex"');

    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", usage: { primary: { usedPercent: "84" } } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("usage.primary.usedPercent must be a finite number or null");

    expect(() =>
      normalizeCodexBarPayload(
        { provider: "claude", usage: {} },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow('CodexBar payload provider "claude" does not match "codex"');
  });

  test("rejects non-array window containers and non-object credits", () => {
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", usage: { windows: "nope" } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("usage.windows must be an array or null.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", usage: { additionalWindows: 3 } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("usage.additionalWindows must be an array or null.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", windows: {} },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("payload.windows must be an array or null.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", usage: { extraRateWindows: "no" } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("usage.extraRateWindows must be an array or null.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", credits: "no" },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("credits must be an object.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", credits: { remaining: 1, unit: 5 } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("credits.unit must be a string or null.");
  });

  test("rejects an error object without a message", () => {
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", error: {} },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("error.message must be a string.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", error: { message: 7 } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("error.message must be a string or null.");
  });

  test("rejects non-string and invalid dates", () => {
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", usage: { primary: { resetsAt: 42 } } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("usage.primary.resetsAt must be an ISO timestamp or null.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", usage: { primary: { resetsAt: "soon" } } },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("usage.primary.resetsAt must be a valid ISO timestamp or null.");
    expect(() =>
      normalizeCodexBarPayload(
        { provider: "codex", subscriptionRenewsAt: true },
        { client: "codex", provider: "codex" },
      ),
    ).toThrow("subscriptionRenewsAt must be an ISO timestamp or null.");
  });
});

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
