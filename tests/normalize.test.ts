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
        },
        {
          kind: "secondary",
          usedPercent: 72.5,
          remainingPercent: 27.5,
          windowMinutes: 10_080,
          resetsAt: null,
        },
        {
          kind: "tertiary",
          usedPercent: null,
          remainingPercent: 100,
          windowMinutes: 43_200,
          resetsAt: "2026-09-01T00:00:00.000Z",
        },
        {
          kind: "monthly",
          usedPercent: 10,
          remainingPercent: 90,
          windowMinutes: 43_200,
          resetsAt: "2026-09-02T00:00:00.000Z",
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

  test("omits Claude synthetic placeholder session windows", () => {
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

    expect(result.windows).toEqual([expect.objectContaining({
      kind: "secondary",
      usedPercent: 42,
      remainingPercent: 58,
    })]);
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
      normalizeCodexBarPayload(
        { provider: "codex", usage: { primary: { usedPercent: "lots" } } },
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
});
