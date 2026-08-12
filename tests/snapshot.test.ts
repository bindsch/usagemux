import { describe, expect, test } from "bun:test";

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
});
