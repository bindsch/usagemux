import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildBackendEnvironment,
  findCodexBarExecutable,
  runCodexBar,
} from "../src/backend";

const FIXTURES = resolve(import.meta.dir, "fixtures");

describe("CodexBar backend", () => {
  test("discovers only executable codexbar files in absolute PATH entries", async () => {
    const validDirectory = resolve(FIXTURES, "valid");
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "usagemux-forbidden-"));
    try {
      expect(await findCodexBarExecutable(
        `relative:${validDirectory}`,
        forbiddenRoot,
      )).toBe(await realpath(resolve(validDirectory, "codexbar")));
      expect(await findCodexBarExecutable(
        "relative:also-relative",
        forbiddenRoot,
      )).toBeNull();
    } finally {
      rmSync(forbiddenRoot, { recursive: true, force: true });
    }
  });

  test("rejects a group- or world-writable CodexBar executable", async () => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(join(tmpdir(), "usagemux-untrusted-"));
    const executable = join(directory, "codexbar");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o777);

    try {
      expect(await findCodexBarExecutable(directory)).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a CodexBar executable inside the caller working tree", async () => {
    const directory = mkdtempSync(join(tmpdir(), "usagemux-worktree-"));
    const executable = join(directory, "codexbar");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    try {
      expect(await findCodexBarExecutable(directory, directory)).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects an executable reached through a world-writable directory", async () => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(join(tmpdir(), "usagemux-writable-path-"));
    const binDirectory = join(directory, "bin");
    const executable = join(binDirectory, "codexbar");
    mkdirSync(binDirectory);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    chmodSync(binDirectory, 0o777);

    try {
      expect(await findCodexBarExecutable(binDirectory, FIXTURES)).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("filters caller-controlled paths and code-loader environment", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "usagemux-environment-"));
    try {
      const environment = await buildBackendEnvironment({
        PATH: `${worktree}:/usr/bin:/bin`,
        BUN_OPTIONS: "--preload=owned.ts",
        NODE_OPTIONS: "--require owned.js",
        DYLD_INSERT_LIBRARIES: "/tmp/owned.dylib",
        OPENAI_API_KEY: "preserved",
      }, worktree);

      expect(environment.PATH?.split(":")).not.toContain(worktree);
      expect(environment.BUN_OPTIONS).toBeUndefined();
      expect(environment.NODE_OPTIONS).toBeUndefined();
      expect(environment.DYLD_INSERT_LIBRARIES).toBeUndefined();
      expect(environment.OPENAI_API_KEY).toBe("preserved");
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("invokes CodexBar with the direct JSON argument contract", async () => {
    const executable = resolve(FIXTURES, "valid", "codexbar");
    await expect(runCodexBar(executable, "codex", 1_000)).resolves.toEqual({
      provider: "codex",
      usage: { primary: { usedPercent: 25 } },
    });
  });

  test("reports malformed provider JSON descriptively", async () => {
    const executable = resolve(FIXTURES, "malformed", "codexbar");
    await expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
      "CodexBar returned malformed JSON for provider codex",
    );
  });

  test("includes bounded stderr context for provider failures", async () => {
    const executable = resolve(FIXTURES, "failing", "codexbar");
    await expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
      "CodexBar failed for provider codex: fixture provider failure",
    );
  });

  test("returns structured CodexBar JSON even when the provider exits nonzero", async () => {
    const executable = resolve(FIXTURES, "structured-error", "codexbar");
    await expect(runCodexBar(executable, "codex", 1_000)).resolves.toEqual([
      {
        provider: "codex",
        source: "codex-cli",
        error: {
          code: 1,
          message: "authentication required",
          kind: "provider",
        },
      },
    ]);
  });

  test("rejects oversized provider output", async () => {
    const executable = resolve(FIXTURES, "oversized", "codexbar");
    await expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
      "CodexBar stdout exceeded 524288 bytes",
    );
  });

  test("terminates the provider process tree on timeout", async () => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(join(tmpdir(), "usagemux-timeout-"));
    const childPidFile = join(directory, "child.pid");
    const executable = resolve(FIXTURES, "hanging", "codexbar");
    const originalPidFile = process.env.USAGEMUX_TEST_PID_FILE;
    process.env.USAGEMUX_TEST_PID_FILE = childPidFile;

    try {
      await expect(runCodexBar(executable, "codex", 200)).rejects.toThrow(
        "CodexBar timed out after 200ms",
      );
      const childPid = Number(await Bun.file(childPidFile).text());
      await Bun.sleep(50);
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      try {
        const childPid = Number(await Bun.file(childPidFile).text());
        process.kill(childPid, "SIGKILL");
      } catch {
        // The expected path has already terminated the child.
      }
      if (originalPidFile === undefined) {
        delete process.env.USAGEMUX_TEST_PID_FILE;
      } else {
        process.env.USAGEMUX_TEST_PID_FILE = originalPidFile;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
