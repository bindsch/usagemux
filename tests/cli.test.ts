import { describe, expect, spyOn, test } from "bun:test";
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

import { main, readPackageVersion } from "../src/cli";
import { BackendUnavailableError, type UsageBackend } from "../src/snapshot";

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
    expect(capture.stderr).toEqual([
      "codex: unavailable: CodexBar was not found on PATH.\n",
    ]);
  });

  test("exit 69 repeats each unavailable reason on stderr, one line per client", async () => {
    const capture = outputCapture();
    const exitCode = await main(
      ["snapshot", "--client", "codex", "--client", "claude", "--client", "aider", "--format", "json"],
      {
        backend: {
          findExecutable: async () => "/trusted/codexbar",
          buildEnvironment: async () => ({}),
          fetch: async (_executable, provider) => {
            throw new BackendUnavailableError(
              `CodexBar could not be started for ${provider}.`,
            );
          },
        },
        io: capture.io,
      },
    );

    expect(exitCode).toBe(69);
    // Only the unavailable clients explain themselves on stderr; the
    // provider-agnostic client keeps its message on stdout alone.
    expect(capture.stderr).toEqual([
      "codex: unavailable: CodexBar could not be started for codex.\n",
      "claude: unavailable: CodexBar could not be started for claude.\n",
    ]);
    const snapshot = JSON.parse(capture.stdout.join("")) as {
      results: { client: string; status: string }[];
    };
    expect(snapshot.results.map(({ client, status }) => ({ client, status })))
      .toEqual([
        { client: "codex", status: "unavailable" },
        { client: "claude", status: "unavailable" },
        { client: "aider", status: "not-applicable" },
      ]);
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

  test("a placeholder primary window is kept with null percents", async () => {
    if (process.platform === "win32") return;
    // Run from outside the checkout, like the launcher test above: the
    // fixture lives inside it, and the caller working tree is a forbidden
    // root for discovery.
    const outside = mkdtempSync(join(tmpdir(), "usagemux-placeholder-"));
    const launcher = resolve(import.meta.dir, "..", "bin", "usagemux");
    const fixturePath = resolve(import.meta.dir, "fixtures", "placeholder");
    const run = async (format: string[]) => {
      const child = Bun.spawn(
        [launcher, "snapshot", "--client", "codex", ...format],
        {
          cwd: outside,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, PATH: fixturePath },
        },
      );
      const [stdout, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);
      return { stdout, exitCode };
    };

    try {
      const json = await run(["--format", "json"]);
      expect(json.exitCode).toBe(0);
      const snapshot = JSON.parse(json.stdout) as {
        results: { windows: unknown[] }[];
      };
      expect(snapshot.results[0]!.windows[0]).toEqual({
        kind: "primary",
        usedPercent: null,
        remainingPercent: null,
        windowMinutes: 300,
        resetsAt: null,
        placeholder: true,
      });

      const text = await run([]);
      expect(text.exitCode).toBe(0);
      expect(text.stdout).toContain("codex: ok");
      expect(text.stdout).toContain("primary: unknown remaining; reset unknown");
      expect(text.stdout).toContain("secondary: 58% remaining");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
