import { describe, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { main, parseCliArgs, readPackageVersion } from "../src/cli";
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
  buildEnvironment: async () => ({}),
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
  test("defaults snapshot to every client except agy, and --all adds it back", () => {
    const parsed = parseCliArgs(["snapshot"]);
    expect(parsed.kind).toBe("snapshot");
    if (parsed.kind === "snapshot") {
      expect(parsed.clients).toHaveLength(15);
      expect(parsed.clients).not.toContain("agy");
      expect(parsed.format).toBe("text");
    }
    const all = parseCliArgs(["snapshot", "--all"]);
    if (all.kind === "snapshot") {
      expect(all.clients).toHaveLength(16);
      expect(all.clients).toContain("agy");
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

  test("rejects a missing or unknown command", () => {
    expect(() => parseCliArgs([])).toThrow("Missing command; expected snapshot.");
    expect(() => parseCliArgs(["frobnicate"])).toThrow(
      'Unknown command "frobnicate".',
    );
  });

  test("accepts snapshot --help and snapshot -h as help", () => {
    expect(parseCliArgs(["snapshot", "--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["snapshot", "-h"])).toEqual({ kind: "help" });
  });

  test("rejects a timeout above the cap", () => {
    expect(() => parseCliArgs(["snapshot", "--timeout", "301"])).toThrow(
      "--timeout cannot exceed 300 seconds.",
    );
    expect(() => parseCliArgs(["snapshot", "--timeout", "1e9"])).toThrow(
      "--timeout cannot exceed 300 seconds.",
    );
  });

  test("rejects unknown options", () => {
    expect(() => parseCliArgs(["snapshot", "--wat"])).toThrow(
      'Unknown option "--wat".',
    );
    expect(() => parseCliArgs(["snapshot", "codex"])).toThrow(
      'Unknown option "codex".',
    );
  });

  test("rejects a missing option value", () => {
    expect(() => parseCliArgs(["snapshot", "--client"])).toThrow(
      "--client requires a value.",
    );
    expect(() => parseCliArgs(["snapshot", "--client", "--format"])).toThrow(
      "--client requires a value.",
    );
    expect(() => parseCliArgs(["snapshot", "--format="])).toThrow(
      "--format requires a value.",
    );
    expect(() => parseCliArgs(["snapshot", "--timeout=--all"])).toThrow(
      "--timeout requires a value.",
    );
  });

  test("readPackageVersion reads the manifest and rejects a non-string version", () => {
    expect(readPackageVersion()).toBe(
      (JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8")) as {
        version: string;
      }).version,
    );

    const directory = mkdtempSync(join(tmpdir(), "usagemux-version-"));
    try {
      const valid = join(directory, "package.json");
      writeFileSync(valid, JSON.stringify({ version: "9.9.9" }));
      expect(readPackageVersion(pathToFileURL(valid))).toBe("9.9.9");

      const invalid = join(directory, "invalid.json");
      writeFileSync(invalid, JSON.stringify({ version: 42 }));
      expect(() => readPackageVersion(pathToFileURL(invalid))).toThrow(
        "package.json is missing a string version.",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

  test("JSON escapes terminal controls without changing decoded provider strings", async () => {
    const capture = outputCapture();
    const controls = String.fromCharCode(
      ...Array.from({ length: 32 }, (_, index) => index),
      ...Array.from({ length: 33 }, (_, index) => 0x7f + index),
    );
    const plan = `Pro ${controls} café \\u009b`;
    const exitCode = await main(
      ["snapshot", "--client", "codex", "--format", "json"],
      {
        backend: { ...backend, fetch: async () => ({ plan, source: plan }) },
        io: capture.io,
      },
    );
    const output = capture.stdout.join("");
    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(output).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(output).toContain("\\u007f");
    expect(output).toContain("\\u009b");
    expect(JSON.parse(output).results[0]).toMatchObject({ plan, source: plan });
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

  test("prints the package version", async () => {
    const capture = outputCapture();
    const exitCode = await main(["--version"], { backend, io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(capture.stdout.join("")).toBe(`usagemux ${readPackageVersion()}\n`);
  });

  test("returns 1 and reports unexpected internal errors", async () => {
    const errored = outputCapture();
    const exitCode = await main(["snapshot", "--client", "codex"], {
      backend: {
        ...backend,
        findExecutable: async () => {
          throw new Error("discovery exploded");
        },
      },
      io: errored.io,
    });

    expect(exitCode).toBe(1);
    expect(errored.stdout).toEqual([]);
    expect(errored.stderr.join("")).toContain(
      "Unexpected error: discovery exploded",
    );

    const nonError = outputCapture();
    const thrown = await main(["snapshot", "--client", "codex"], {
      backend: {
        ...backend,
        findExecutable: async () => {
          throw "a string";
        },
      },
      io: nonError.io,
    });

    expect(thrown).toBe(1);
    expect(nonError.stderr.join("")).toContain("Unexpected error: a string");
  });

  test("without injected IO, output goes to the real streams", async () => {
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await main(["--version"])).toBe(0);
      expect(write).toHaveBeenCalledWith(`usagemux ${readPackageVersion()}\n`);
    } finally {
      write.mockRestore();
    }
  });

  test("launcher exits promptly once cleanup settles", async () => {
    if (process.platform === "win32") return;
    // Run from outside the checkout: the fixtures live inside it, and the
    // caller working tree is a forbidden root for discovery.
    const outside = mkdtempSync(join(tmpdir(), "usagemux-prompt-"));
    const launcher = resolve(import.meta.dir, "..", "bin", "usagemux");
    const cases = [
      { fixture: "malformed", expects: "codex: error" },
      { fixture: "valid", expects: "codex: ok" },
    ];
    try {
      for (const { fixture, expects } of cases) {
        const startedAt = Date.now();
        const child = Bun.spawn(
          [launcher, "snapshot", "--client", "codex"],
          {
            cwd: outside,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              PATH: resolve(import.meta.dir, "fixtures", fixture),
            },
          },
        );
        const [stdout, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          child.exited,
        ]);
        const elapsed = Date.now() - startedAt;
        expect(exitCode).toBe(0);
        expect(stdout).toContain(expects);
        // A cleanup-cap timer that outlives cleanup held the process about
        // two seconds after its output was printed.
        expect(elapsed).toBeLessThan(1_000);
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
