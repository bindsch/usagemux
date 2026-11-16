import { describe, expect, test } from "bun:test";
import { main, HELP_TEXT, parseCliArgs } from "../src/cli";
import { BackendProcessError, BackendTimeoutError } from "../src/backend";
import { CLIENT_PROVIDERS, SUPPORTED_CLIENTS } from "../src/clients";
import { createSnapshot, type UsageBackend } from "../src/snapshot";

function backend(fetch: UsageBackend["fetch"]): UsageBackend {
  return {
    findExecutable: async () => "/fixture/codexbar",
    buildEnvironment: async () => ({}),
    fetch,
  };
}

describe("default selection and provider timeouts", () => {
  test("bare snapshot and --all fetch every mapped provider with its own default", async () => {
    for (const selection of [[], ["--all"]]) {
      const calls: Array<[string, number]> = [];
      let output = "";
      const code = await main(["snapshot", ...selection, "--format=json"], {
        backend: backend(async (_exe, provider, timeout) => {
          calls.push([provider, timeout]);
          return { provider };
        }),
        io: { stdout: value => { output += value; }, stderr: () => {} },
      });
      expect(code).toBe(0);
      expect(calls).toEqual(SUPPORTED_CLIENTS.filter(client => CLIENT_PROVIDERS[client] !== null)
        .map(client => [CLIENT_PROVIDERS[client]!, client === "agy" ? 90_000 : client === "claude" ? 60_000 : 10_000]));
      expect(JSON.parse(output).results.map((result: { client: string }) => result.client)).toEqual([...SUPPORTED_CLIENTS]);
    }
  });

  test("an explicit timeout overrides every provider and the last value wins", async () => {
    const calls: number[] = [];
    const parsed = parseCliArgs(["snapshot", "--all", "--timeout", "60", "--timeout=2.5"]);
    if (parsed.kind !== "snapshot") throw new Error("Expected snapshot arguments");
    await createSnapshot(parsed, { backend: backend(async (_exe, provider, timeout) => {
      calls.push(timeout);
      return { provider };
    }) });
    expect(calls.length).toBe(12);
    expect(calls.every(timeout => timeout === 2_500)).toBe(true);
  });

  test("selected providers use defaults concurrently and results retain selection order", async () => {
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const pending = createSnapshot({ clients: ["claude", "agy", "codex"] }, {
      backend: backend(async (_exe, provider, timeout) => {
        started.push(provider);
        expect(timeout).toBe(provider === "claude" ? 60_000 : provider === "antigravity" ? 90_000 : 10_000);
        await new Promise<void>(resolve => { finish.set(provider, resolve); });
        return { provider };
      }),
    });
    // Discovery and environment resolution each yield one microtask.
    await Promise.resolve();
    await Promise.resolve();
    try {
      expect(started).toEqual(["claude", "antigravity", "codex"]);
    } finally {
      for (const release of [...finish.values()].reverse()) release();
    }
    expect((await pending).results.map(result => result.client)).toEqual(["claude", "agy", "codex"]);
  });

  test("timeout remedies reflect the effective defaults and the explicit cap", async () => {
    for (const timeoutMs of [undefined, 300_000]) {
      const snapshot = await createSnapshot({ clients: ["claude", "agy", "codex"], timeoutMs }, {
        backend: backend(async (_exe, _provider, timeout) => {
          throw new BackendTimeoutError(`CodexBar timed out after ${timeout}ms.`);
        }),
      });
      const defaults = [60_000, 90_000, 10_000];
      snapshot.results.forEach((result, i) => {
        expect(result.message).toContain(`after ${timeoutMs ?? defaults[i]}ms.`);
        expect(result.message).toContain(timeoutMs === undefined ? `Retry this client with --client ${result.client} --timeout <seconds>` : "cap already in use");
        if (timeoutMs === undefined) expect(result.message).toContain("--timeout applies to every selected client.");
        expect(result.message).not.toContain("says nothing about whether the harness is signed in");
        expect(result.message).not.toContain("CodexBar reported:");
      });
    }
  });

  test("help documents all clients, per-client defaults, and a global override", () => {
    expect(HELP_TEXT).toContain("exactly as with --all");
    expect(HELP_TEXT).toContain("10 seconds generally, 60 for claude, 90 for agy");
    expect(HELP_TEXT).toContain("Override every selected client's timeout");
    expect(HELP_TEXT).toContain("Retry one client with --client <name> --timeout <seconds>.");
    expect(HELP_TEXT).toContain("Providers run in parallel");
  });

  test("CLI output preserves and attributes backend login claims from JSON or thrown failures", async () => {
    for (const thrown of [false, true]) {
      let output = "";
      const code = await main(["snapshot", "--client=kimi", "--format=json"], {
        backend: backend(async () => {
          const message = "No available fetch strategy for kimi. Run kimi and sign in when prompted.";
          if (thrown) throw new BackendProcessError("kimi", message);
          return { provider: "kimi", source: "kimi-cli", error: { message } };
        }),
        io: { stdout: value => { output += value; }, stderr: () => {} },
      });
      expect(code).toBe(0);
      const result = JSON.parse(output).results[0];
      expect(result.status).toBe("error");
      expect(result.message).toStartWith(thrown ? "CodexBar failed for provider kimi: CodexBar reported: " : "CodexBar reported: ");
      expect(result.message).toContain("No available fetch strategy for kimi. Run kimi and sign in when prompted.");
      expect(result.message).toEndWith("This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.");
    }
  });
});
