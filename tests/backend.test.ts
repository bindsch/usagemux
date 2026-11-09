import { describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  BackendUnavailableError,
  CodexBarBackend,
  buildBackendEnvironment,
  findCodexBarExecutable,
  runCodexBar,
} from "../src/backend";

const FIXTURES = resolve(import.meta.dir, "fixtures");

// The first realpath a swap-aware test registers flips the executable's
// write bits, modeling a replacement during child-environment resolution
// (trustedPath realpaths every PATH entry). The passthrough wrapper keeps
// realpath working for the rest of this file; mock.module reaches modules
// imported before it, including ../src/backend.
const realRealpath = fsPromises.realpath;
let swapOnNextRealpath: (() => void) | undefined;

mock.module("node:fs/promises", () => ({
  ...fsPromises,
  realpath: ((path: unknown, options?: unknown) => {
    const swap = swapOnNextRealpath;
    swapOnNextRealpath = undefined;
    swap?.();
    return (realRealpath as (p: unknown, o?: unknown) => Promise<unknown>)(
      path,
      options,
    );
  }) as typeof fsPromises.realpath,
}));

// Discovery rejects an executable whose directory chain has a world-writable
// member, with or without the sticky bit (docs/BACKEND.md). os.tmpdir() is
// /tmp on Linux runners, mode 1777, so every fixture created there is
// refused by the directory-chain rule before the rule a test targets is
// reached: positive tests fail, and negative tests pass for the wrong
// reason. Tests that need a trusted location therefore use tmpdir() only
// when its chain is trusted (the per-user /var/folders/.../T on macOS) and
// fall back to the home directory otherwise.
function isTrustedChain(start: string): boolean {
  let current = realpathSync(start);
  while (true) {
    const metadata = statSync(current);
    if ((metadata.mode & 0o002) !== 0) return false;
    if (
      typeof process.getuid === "function" &&
      metadata.uid !== process.getuid() &&
      metadata.uid !== 0
    ) {
      return false;
    }
    const parent = dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

function trustedTempBase(): string {
  if (process.platform === "win32" || isTrustedChain(tmpdir())) {
    return tmpdir();
  }
  if (isTrustedChain(homedir())) {
    return homedir();
  }
  throw new Error("No trusted directory for backend test fixtures.");
}

const TRUSTED_TMP = trustedTempBase();

function trustedTempDir(prefix: string): string {
  return mkdtempSync(join(TRUSTED_TMP, prefix));
}

// The per-spawn trust re-check applies discovery's working-tree exclusion,
// and the fixtures live inside this checkout, so a fetch against a fixture
// executable runs from outside the checkout, like a real caller.
async function outsideCheckout(run: () => unknown): Promise<void> {
  const originalCwd = process.cwd();
  process.chdir(tmpdir());
  try {
    await run();
  } finally {
    process.chdir(originalCwd);
  }
}

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
    const directory = trustedTempDir("usagemux-untrusted-");
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
    const directory = trustedTempDir("usagemux-worktree-");
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
    const directory = trustedTempDir("usagemux-writable-path-");
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

  test("rejects an executable below a sticky world-writable directory", async () => {
    if (process.platform === "win32") return;
    // The layout of /tmp on Linux: a 1777 parent holding a 0700 directory
    // the current user owns. The sticky bit does not make the parent
    // trusted; this pins the documented rule the Linux CI run exposed.
    const directory = trustedTempDir("usagemux-sticky-");
    const sticky = join(directory, "shared");
    const owned = join(sticky, "owned");
    const executable = join(owned, "codexbar");
    mkdirSync(owned, { recursive: true });
    chmodSync(owned, 0o700);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    try {
      // Control: the same layout is accepted while the parent is 0755.
      expect(await findCodexBarExecutable(owned, FIXTURES)).toBe(
        await realpath(executable),
      );
      chmodSync(sticky, 0o1777);
      expect(await findCodexBarExecutable(owned, FIXTURES)).toBeNull();
    } finally {
      chmodSync(sticky, 0o755);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("filters caller-controlled paths and code-loader environment", async () => {
    const worktree = trustedTempDir("usagemux-environment-");
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
    await outsideCheckout(() =>
      expect(runCodexBar(executable, "codex", 1_000)).resolves.toEqual({
        provider: "codex",
        usage: { primary: { usedPercent: 25 } },
      }),
    );
  });

  test("reports malformed provider JSON descriptively", async () => {
    const executable = resolve(FIXTURES, "malformed", "codexbar");
    await outsideCheckout(() =>
      expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
        "CodexBar returned malformed JSON for provider codex",
      ),
    );
  });

  test("includes bounded stderr context for provider failures", async () => {
    const executable = resolve(FIXTURES, "failing", "codexbar");
    await outsideCheckout(() =>
      expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
        "CodexBar failed for provider codex: fixture provider failure",
      ),
    );
  });

  test("returns structured CodexBar JSON even when the provider exits nonzero", async () => {
    const executable = resolve(FIXTURES, "structured-error", "codexbar");
    await outsideCheckout(() =>
      expect(runCodexBar(executable, "codex", 1_000)).resolves.toEqual([
        {
          provider: "codex",
          source: "codex-cli",
          error: {
            code: 1,
            message: "authentication required",
            kind: "provider",
          },
        },
      ]),
    );
  });

  test("rejects oversized provider output", async () => {
    const executable = resolve(FIXTURES, "oversized", "codexbar");
    await outsideCheckout(() =>
      expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
        "CodexBar stdout exceeded 524288 bytes",
      ),
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
      await outsideCheckout(() =>
        expect(runCodexBar(executable, "codex", 200)).rejects.toThrow(
          "CodexBar timed out after 200ms",
        ),
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

  test("reports a backend that cannot be started", async () => {
    if (process.platform === "win32") return;
    // The trust re-check refuses a non-executable before the spawn, so the
    // catch around Bun.spawn is reachable only when the mode flips in the
    // instant between the re-check's access() and the spawn. Simulate that
    // race deterministically by making the spawn itself throw the EACCES a
    // non-executable path would raise.
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("EACCES: permission denied, access 'codexbar'");
    });
    const executable = resolve(FIXTURES, "valid", "codexbar");

    try {
      const failure = outsideCheckout(() =>
        runCodexBar(executable, "codex", 1_000),
      );
      await expect(failure).rejects.toBeInstanceOf(BackendUnavailableError);
      await expect(failure).rejects.toThrow(
        "CodexBar could not be started: EACCES: permission denied, access 'codexbar'",
      );
    } finally {
      spawn.mockRestore();
    }
  });

  test("re-validates the executable immediately before every spawn", async () => {
    if (process.platform === "win32") return;
    const directory = trustedTempDir("usagemux-recheck-");
    const executable = join(directory, "codexbar");
    writeFileSync(executable, "#!/bin/sh\necho '{\"provider\":\"codex\"}'\n");
    chmodSync(executable, 0o755);

    try {
      await expect(runCodexBar(executable, "codex", 1_000)).resolves.toEqual({
        provider: "codex",
      });

      // Swap the file to group-writable after discovery would have accepted it.
      chmodSync(executable, 0o775);
      await expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
        "CodexBar failed its trust re-check immediately before launch",
      );

      chmodSync(executable, 0o755);
      rmSync(executable);
      await expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
        "CodexBar failed its trust re-check immediately before launch",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses a backend swapped while the child environment is resolved", async () => {
    if (process.platform === "win32") return;
    const directory = trustedTempDir("usagemux-swap-window-");
    const executable = join(directory, "codexbar");
    writeFileSync(executable, "#!/bin/sh\necho '{\"provider\":\"codex\"}'\n");
    chmodSync(executable, 0o755);
    const originalPath = process.env.PATH;

    try {
      // With no environment argument, runCodexBar builds one and realpaths
      // PATH entries; the flip lands inside that resolution. Only a re-check
      // ordered after the resolution can refuse the swapped executable.
      process.env.PATH = directory;
      swapOnNextRealpath = () => chmodSync(executable, 0o775);
      await expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
        "CodexBar failed its trust re-check immediately before launch",
      );
    } finally {
      swapOnNextRealpath = undefined;
      process.env.PATH = originalPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses an executable replaced by a symlink into the working tree", async () => {
    if (process.platform === "win32") return;
    const worktree = trustedTempDir("usagemux-symlink-tree-");
    const pathDirectory = trustedTempDir("usagemux-symlink-path-");
    const executable = join(pathDirectory, "codexbar");
    writeFileSync(executable, "#!/bin/sh\necho '{\"provider\":\"codex\"}'\n");
    chmodSync(executable, 0o755);
    // The planted script passes every per-file rule: regular file, 0755,
    // current user, executable. Only re-resolving the alias and re-checking
    // the working-tree exclusion can refuse it.
    const planted = join(worktree, "codexbar");
    writeFileSync(
      planted,
      "#!/bin/sh\necho '{\"provider\":\"codex\",\"source\":\"planted\"}'\n",
    );
    chmodSync(planted, 0o755);
    const originalCwd = process.cwd();

    try {
      process.chdir(worktree);
      const discovered = await findCodexBarExecutable(pathDirectory);
      expect(discovered).toBe(await realpath(executable));

      rmSync(discovered!);
      symlinkSync(planted, discovered!);
      await expect(runCodexBar(discovered!, "codex", 1_000)).rejects.toThrow(
        "CodexBar failed its trust re-check immediately before launch",
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(worktree, { recursive: true, force: true });
      rmSync(pathDirectory, { recursive: true, force: true });
    }
  });

  test("releases a fetch whose escaped descendant holds the pipe", async () => {
    if (process.platform === "win32" || !Bun.which("python3")) return;
    // The descendant escapes only once python3 has started and forked. On a
    // fresh macOS runner the first python3 start can take longer than a
    // short fetch timeout; the timeout then kills the whole group before
    // the escape, nothing holds the pipe, and the fetch correctly returns
    // right after the grace period (CI run 42683255513: 471 ms). Warm
    // python3 first, give the fetch a timeout long enough for the escape,
    // and assert the escape happened before reading the timing.
    Bun.spawnSync(["python3", "-c", "pass"]);
    const directory = mkdtempSync(join(tmpdir(), "usagemux-escaped-"));
    const descendantPidFile = join(directory, "descendant.pid");
    const executable = resolve(FIXTURES, "escaped-descendant", "codexbar");
    const originalPidFile = process.env.USAGEMUX_TEST_PID_FILE;
    process.env.USAGEMUX_TEST_PID_FILE = descendantPidFile;

    try {
      const startedAt = Date.now();
      await outsideCheckout(() =>
        expect(runCodexBar(executable, "codex", 1_000)).rejects.toThrow(
          "CodexBar timed out after 1000ms",
        ),
      );
      const elapsed = Date.now() - startedAt;
      // The descendant writes its pid only after setsid(), so the file
      // exists only if it left the process group before the timeout's
      // signals reached it.
      expect(await Bun.file(descendantPidFile).exists()).toBe(true);
      // 1 s timer + 250 ms grace + at most 2 s cleanup cap; the escaped
      // descendant holds the pipe for 10 s, so only the cap can release here.
      expect(elapsed).toBeGreaterThanOrEqual(3_200);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      // The descendant left the process group before any signal, so only
      // this test terminates it.
      let descendantPid = 0;
      try {
        descendantPid = Number(await Bun.file(descendantPidFile).text());
        process.kill(descendantPid, "SIGKILL");
      } catch {
        // It ended on its own before cleanup read the pid.
      }
      if (originalPidFile === undefined) {
        delete process.env.USAGEMUX_TEST_PID_FILE;
      } else {
        process.env.USAGEMUX_TEST_PID_FILE = originalPidFile;
      }
      rmSync(directory, { recursive: true, force: true });
      if (descendantPid !== 0) {
        await Bun.sleep(50);
        expect(() => process.kill(descendantPid, 0)).toThrow();
      }
    }
  }, 15_000);

  test("the CodexBar backend resolves its executable, environment, and fetch together", async () => {
    const backend = new CodexBarBackend();
    const originalPath = process.env.PATH;
    const originalCwd = process.cwd();
    // Run from outside the checkout: the fixtures live inside it, and the
    // caller working tree is a forbidden root for discovery.
    process.env.PATH = resolve(FIXTURES, "valid");
    process.chdir(tmpdir());
    try {
      const executable = await backend.findExecutable();
      expect(executable).toBe(
        await realpath(resolve(FIXTURES, "valid", "codexbar")),
      );
      const environment = await backend.buildEnvironment();
      expect(environment.PATH).toBeDefined();
      await expect(
        backend.fetch(executable!, "codex", 1_000, environment),
      ).resolves.toEqual({
        provider: "codex",
        usage: { primary: { usedPercent: 25 } },
      });
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
    }
  });
});
