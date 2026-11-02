import { describe, expect, test } from "bun:test";

import { BackendTimeoutError } from "../src/backend";
import {
  BackendUnavailableError,
  createSnapshot,
  determineExitCode,
  type UsageBackend,
} from "../src/snapshot";

const NOW = new Date("2026-08-03T10:00:00Z");

function backend(overrides: Partial<UsageBackend> = {}): UsageBackend {
  return {
    findExecutable: async () => "/trusted/codexbar",
    buildEnvironment: async () => ({}),
    fetch: async (_executable, provider) => ({
      provider,
      usage: { primary: { usedPercent: 25 } },
    }),
    ...overrides,
  };
}

describe("snapshot orchestration", () => {
  test("emits not-applicable without consulting the backend", async () => {
    let discovered = false;
    const result = await createSnapshot(
      { clients: ["aider", "goose", "pi"], timeoutMs: 1_000 },
      {
        backend: backend({
          findExecutable: async () => {
            discovered = true;
            return null;
          },
        }),
        now: () => NOW,
      },
    );

    expect(discovered).toBe(false);
    expect(result.generatedAt).toBe("2026-08-03T10:00:00.000Z");
    expect(result.results.map(({ status }) => status)).toEqual([
      "not-applicable",
      "not-applicable",
      "not-applicable",
    ]);
    expect(determineExitCode(result)).toBe(0);
  });

  test("reports every applicable client unavailable when CodexBar is missing", async () => {
    const result = await createSnapshot(
      { clients: ["codex", "claude"], timeoutMs: 1_000 },
      {
        backend: backend({ findExecutable: async () => null }),
        now: () => NOW,
      },
    );

    expect(result.results).toEqual([
      expect.objectContaining({
        client: "codex",
        status: "unavailable",
        message: "CodexBar was not found on PATH.",
      }),
      expect.objectContaining({
        client: "claude",
        status: "unavailable",
        message: "CodexBar was not found on PATH.",
      }),
    ]);
    expect(determineExitCode(result)).toBe(69);
  });

  test("keeps partial provider failures in-band", async () => {
    const result = await createSnapshot(
      { clients: ["codex", "claude"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async (_executable, provider) => {
            if (provider === "claude") {
              throw new Error("provider request failed");
            }
            return { provider, usage: { primary: { usedPercent: 25 } } };
          },
        }),
        now: () => NOW,
      },
    );

    expect(result.results.map(({ status }) => status)).toEqual(["ok", "error"]);
    expect(result.results[1]?.message).toBe("provider request failed");
    expect(determineExitCode(result)).toBe(0);
  });

  test("treats an unusable backend as unavailable", async () => {
    const result = await createSnapshot(
      { clients: ["codex"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async () => {
            throw new BackendUnavailableError("CodexBar could not be started.");
          },
        }),
        now: () => NOW,
      },
    );

    expect(result.results[0]).toMatchObject({
      status: "unavailable",
      message: "CodexBar could not be started.",
    });
    expect(determineExitCode(result)).toBe(69);
  });

  test("appends an actionable remedy to upstream no-strategy errors", async () => {
    const result = await createSnapshot(
      { clients: ["copilot", "kimi"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async (_executable, provider) => {
            if (provider === "copilot") {
              throw new Error("No available fetch strategy for copilot.");
            }
            return { provider, usage: { primary: { usedPercent: 10 } } };
          },
        }),
        now: () => NOW,
      },
    );

    expect(result.results.map(({ status }) => status)).toEqual([
      "error",
      "ok",
    ]);
    expect(result.results[0]?.message).toContain(
      "Add a Copilot account in CodexBar",
    );
    expect(result.results[1]?.message).toBe(null);
    expect(determineExitCode(result)).toBe(0);
  });

  test("appends remedies to structured provider errors, not only thrown ones", async () => {
    // CodexBar exits non-zero but still prints JSON for provider errors; the
    // message arrives through the normalizer, not through a thrown Error.
    const result = await createSnapshot(
      { clients: ["copilot"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async () => ({
            provider: "copilot",
            error: { message: "No available fetch strategy for copilot." },
          }),
        }),
        now: () => NOW,
      },
    );

    expect(result.results[0]?.status).toBe("error");
    expect(result.results[0]?.message).toBe(
      "No available fetch strategy for copilot. Add a Copilot account in CodexBar (menu > Add / switch account, GitHub device flow); a plain gh auth token cannot authenticate to the Copilot usage API.",
    );
  });

  test("appends the timeout remedy for slow providers", async () => {
    const result = await createSnapshot(
      { clients: ["agy"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async () => {
            throw new BackendTimeoutError("CodexBar timed out after 10000ms.");
          },
        }),
        now: () => NOW,
      },
    );

    expect(result.results[0]?.status).toBe("error");
    expect(result.results[0]?.message).toContain(
      "Retry with a longer --timeout (up to 300 seconds)",
    );
  });

  test("reports kimi through the codexbar kimi provider", async () => {
    const seenProviders: string[] = [];
    const result = await createSnapshot(
      { clients: ["kimi"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async (_executable, provider) => {
            seenProviders.push(provider);
            return {
              provider,
              usage: { secondary: { usedPercent: 40, resetsAt: "2026-08-04T12:00:00Z" } },
            };
          },
        }),
        now: () => NOW,
      },
    );

    expect(seenProviders).toEqual(["kimi"]);
    expect(result.results[0]).toMatchObject({
      client: "kimi",
      provider: "kimi",
      status: "ok",
    });
  });

  test("not-applicable mixed with unavailable still exits 69", async () => {
    const result = await createSnapshot(
      { clients: ["aider", "codex"], timeoutMs: 1_000 },
      {
        backend: backend({ findExecutable: async () => null }),
        now: () => NOW,
      },
    );

    expect(result.results.map(({ status }) => status)).toEqual([
      "not-applicable",
      "unavailable",
    ]);
    expect(determineExitCode(result)).toBe(69);
  });

  test("unavailable mixed with error exits 0", async () => {
    const result = await createSnapshot(
      { clients: ["codex", "claude"], timeoutMs: 1_000 },
      {
        backend: backend({
          fetch: async (_executable, provider) => {
            if (provider === "claude") {
              throw new BackendUnavailableError("CodexBar could not be started.");
            }
            throw new Error("provider request failed");
          },
        }),
        now: () => NOW,
      },
    );

    expect(result.results.map(({ status }) => status)).toEqual([
      "error",
      "unavailable",
    ]);
    expect(determineExitCode(result)).toBe(0);
  });

  test("builds the child environment once per snapshot and shares it", async () => {
    const shared = { PATH: "/usr/bin" };
    const seen: unknown[] = [];
    let builds = 0;
    const result = await createSnapshot(
      { clients: ["codex", "claude"], timeoutMs: 1_000 },
      {
        backend: backend({
          buildEnvironment: async () => {
            builds += 1;
            return shared;
          },
          fetch: async (_executable, provider, _timeoutMs, environment) => {
            seen.push(environment);
            return { provider, usage: { primary: { usedPercent: 25 } } };
          },
        }),
        now: () => NOW,
      },
    );

    expect(builds).toBe(1);
    expect(result.results.map(({ status }) => status)).toEqual(["ok", "ok"]);
    expect(seen[0]).toBe(shared);
    expect(seen[1]).toBe(shared);
  });
});
