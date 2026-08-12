import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { main, parseCliArgs } from "../src/cli";
import type { UsageBackend } from "../src/snapshot";

function outputCapture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
    stdout,
    stderr,
  };
}

const backend: UsageBackend = {
  findExecutable: async () => "/trusted/codexbar",
  fetch: async (_executable, provider) => ({
    provider,
    plan: "plus",
    usage: {
      primary: {
        usedPercent: 40,
        resetsAt: "2026-08-04T10:00:00Z",
      },
    },
  }),
};

describe("CLI arguments", () => {
  test("defaults snapshot to all clients", () => {
    const parsed = parseCliArgs(["snapshot"]);
    expect(parsed.kind).toBe("snapshot");
    if (parsed.kind === "snapshot") {
      expect(parsed.clients).toHaveLength(13);
      expect(parsed.format).toBe("text");
    }
  });

  test("accepts repeated clients and timeout seconds", () => {
    expect(
      parseCliArgs([
        "snapshot",
        "--client",
        "codex",
        "--client=claude",
        "--format",
        "json",
        "--timeout",
        "2.5",
      ]),
    ).toMatchObject({
      kind: "snapshot",
      clients: ["codex", "claude"],
      format: "json",
      timeoutMs: 2_500,
    });
  });

  test("rejects conflicting and invalid arguments", () => {
    expect(() =>
      parseCliArgs(["snapshot", "--all", "--client", "codex"]),
    ).toThrow("--all cannot be combined with --client");
    expect(() => parseCliArgs(["snapshot", "--client", "vim"])).toThrow(
      'Unsupported client "vim"',
    );
    expect(() => parseCliArgs(["snapshot", "--format", "yaml"])).toThrow(
      'Unsupported format "yaml"',
    );
    expect(() => parseCliArgs(["snapshot", "--timeout", "0"])).toThrow(
      "--timeout must be a number greater than 0",
    );
  });
});

describe("CLI execution", () => {
  test("installed launcher is not group- or world-writable", () => {
    if (process.platform === "win32") return;
    const launcher = resolve(import.meta.dir, "..", "bin", "usagemux");
    expect(statSync(launcher).mode & 0o022).toBe(0);
  });

  test("installed launcher ignores hostile working-tree Bun config and dotenv", async () => {
    const hostile = mkdtempSync(join(tmpdir(), "usagemux-hostile-"));
    const marker = join(hostile, "preload-ran");
    const interpreterMarker = join(hostile, "hostile-bun-ran");
    const linkedBin = join(hostile, "bin", "usagemux");
    mkdirSync(join(hostile, "bin"), { recursive: true });
    symlinkSync(resolve(import.meta.dir, "..", "bin", "usagemux"), linkedBin);
    writeFileSync(
      join(hostile, "owned.ts"),
      `await Bun.write(${JSON.stringify(marker)}, "owned");`,
    );
    writeFileSync(join(hostile, "bunfig.toml"), 'preload = ["./owned.ts"]\n');
    writeFileSync(join(hostile, ".env"), "USAGEMUX_HOSTILE_ENV=1\n");
    writeFileSync(
      join(hostile, "bin", "bun"),
      `#!/bin/sh\necho owned > ${JSON.stringify(interpreterMarker)}\nexit 99\n`,
    );
    chmodSync(join(hostile, "bin", "bun"), 0o755);

    try {
      const processHandle = Bun.spawn([linkedBin, "--help"], {
        cwd: hostile,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: `${join(hostile, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
          BUN_OPTIONS: "--preload=./owned.ts",
        },
      });
      const [stdout, exitCode] = await Promise.all([
        new Response(processHandle.stdout).text(),
        processHandle.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("usagemux snapshot");
      expect(await Bun.file(marker).exists()).toBe(false);
      expect(await Bun.file(interpreterMarker).exists()).toBe(false);
    } finally {
      rmSync(hostile, { recursive: true, force: true });
    }
  });

  test("prints v1 JSON and exits zero", async () => {
    const capture = outputCapture();
    const exitCode = await main(
      ["snapshot", "--client", "codex", "--format", "json"],
      {
        backend,
        now: () => new Date("2026-08-03T10:00:00Z"),
        io: capture.io,
      },
    );

    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join(""))).toEqual({
      schemaVersion: "1",
      generatedAt: "2026-08-03T10:00:00.000Z",
      results: [
        expect.objectContaining({
          client: "codex",
          provider: "codex",
          status: "ok",
        }),
      ],
    });
  });

  test("prints concise text output", async () => {
    const capture = outputCapture();
    const exitCode = await main(["snapshot", "--client", "codex"], {
      backend,
      now: () => new Date("2026-08-03T10:00:00Z"),
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(capture.stdout.join("")).toContain("codex: ok (plus)");
    expect(capture.stdout.join("")).toContain(
      "primary: 60% remaining; resets 2026-08-04T10:00:00.000Z",
    );
  });

  test("returns 69 when the backend is missing", async () => {
    const capture = outputCapture();
    const exitCode = await main(["snapshot", "--client", "codex"], {
      backend: { ...backend, findExecutable: async () => null },
      io: capture.io,
    });

    expect(exitCode).toBe(69);
    expect(capture.stdout.join("")).toContain("codex: unavailable");
  });

  test("returns 64 for usage errors", async () => {
    const capture = outputCapture();
    const exitCode = await main(["snapshot", "--format", "yaml"], {
      backend,
      io: capture.io,
    });

    expect(exitCode).toBe(64);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr.join("")).toContain('Unsupported format "yaml"');
  });

  test("prints help without touching the backend", async () => {
    const capture = outputCapture();
    let discovered = false;
    const exitCode = await main(["--help"], {
      backend: {
        ...backend,
        findExecutable: async () => {
          discovered = true;
          return null;
        },
      },
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(discovered).toBe(false);
    expect(capture.stdout.join("")).toContain("usagemux snapshot");
  });
});
