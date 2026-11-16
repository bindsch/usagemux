import { describe, expect, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { MAX_OUTPUT_BYTES, runCodexBar } from "../src/backend";
import { createSnapshot, type UsageBackend } from "../src/snapshot";

const EXECUTABLE = resolve(import.meta.dir, "fixtures/valid/codexbar");

function backend(fetch: UsageBackend["fetch"]): UsageBackend {
  return {
    findExecutable: async () => EXECUTABLE,
    buildEnvironment: async () => ({}),
    fetch,
  };
}

async function result(fetch: UsageBackend["fetch"]) {
  return (await createSnapshot({ clients: ["claude"] }, { backend: backend(fetch) })).results[0]!;
}

describe("error origin", () => {
  test("schema diagnostics stay local even when their text matches upstream errors", async () => {
    for (const [payload, message] of [
      [{ provider: "claude", usage: { primary: { usedPercent: "bad" } } },
        "usage.primary.usedPercent must be a finite number or null."],
      [{ provider: "claude", error: {} }, "error.message must be a string."],
      [[{ provider: "codex" }, { provider: "kimi" }], 'CodexBar payload has no result for provider "claude".'],
    ] as const) {
      expect((await result(async () => payload)).message).toBe(message);
      expect((await result(async () => ({ provider: "claude", error: { message } }))).message)
        .toBe(`CodexBar reported: ${message} This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.`);
    }
    const message = "Run claude login to continue";
    expect((await result(async () => { throw new Error(message); })).message).toBe(message);
    expect((await result(async () => { throw message; })).message).toBe(message);
  });

  test("process failures attribute only stderr, while empty-stderr exits and wrapper failures stay local", async () => {
    const originalCwd = process.cwd();
    // Reuse a trusted fixture only for validation. Every spawn is mocked.
    process.chdir(tmpdir());
    const spawn = spyOn(Bun, "spawn");
    try {
      for (const [stdout, stderr, exitCode, expected] of [
        ["", "Run claude login to continue", 1,
          "CodexBar failed for provider claude: CodexBar reported: Run claude login to continue This is CodexBar's own diagnostic and says nothing about whether the harness is signed in."],
        // CodexBar wrote nothing: the text is usagemux's own and carries no CodexBar attribution.
        ["", "", 7, "CodexBar exited with code 7 and wrote no diagnostic for provider claude."],
        ["", "", 0, "CodexBar returned empty JSON for provider claude."],
        ["null", "", 0, "CodexBar returned empty JSON for provider claude."],
        ["x", "Run claude login", 1, "CodexBar returned malformed JSON for provider claude:"],
        ["x".repeat(MAX_OUTPUT_BYTES + 1), "", 0, `CodexBar stdout exceeded ${MAX_OUTPUT_BYTES} bytes.`],
        ["", "x".repeat(MAX_OUTPUT_BYTES + 1), 1, `CodexBar stderr exceeded ${MAX_OUTPUT_BYTES} bytes.`],
      ] as const) {
        spawn.mockImplementation(() => ({
          stdout: new Response(stdout).body!, stderr: new Response(stderr).body!,
          exited: Promise.resolve(exitCode),
          // An out-of-range PID cannot signal a real process during cleanup.
          pid: Number.MAX_SAFE_INTEGER, kill: () => {},
        }) as unknown as ReturnType<typeof Bun.spawn>);
        const actual = await result((exe, provider, timeout, environment) =>
          runCodexBar(exe, provider, timeout, environment));
        expect(actual.status).toBe("error");
        if (stdout === "x") {
          expect(actual.message).toStartWith(expected);
          expect(actual.message).not.toContain("CodexBar reported:");
        } else {
          expect(actual.message).toBe(expected);
        }
      }
      spawn.mockImplementation(() => { throw new Error("fixture start failure"); });
      expect(await result((exe, provider, timeout, environment) => runCodexBar(exe, provider, timeout, environment)))
        .toMatchObject({ status: "unavailable", message: "CodexBar could not be started: fixture start failure" });
      expect(await result((_exe, provider, timeout, environment) => runCodexBar("/missing/fixture", provider, timeout, environment)))
        .toMatchObject({ status: "unavailable", message: "CodexBar failed its trust re-check immediately before launch: /missing/fixture" });
    } finally {
      spawn.mockRestore();
      process.chdir(originalCwd);
    }
  });
});
