import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import type { ReadableStreamDefaultReader } from "node:stream/web";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export const CODEXBAR_EXECUTABLE = "codexbar";
export const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_ERROR_DETAIL_CHARS = 8 * 1024;
const PROCESS_TERMINATION_GRACE_MS = 250;
const CLEANUP_WAIT_CAP_MS = 2_000;
const FORBIDDEN_ENV_NAMES = new Set([
  "BASH_ENV",
  "BUN_OPTIONS",
  "ENV",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PERL5LIB",
  "PERL5OPT",
  "PYTHONHOME",
  "PYTHONPATH",
  "RUBYLIB",
  "RUBYOPT",
  "_JAVA_OPTIONS",
]);
const FORBIDDEN_ENV_PREFIXES = ["DYLD_", "LD_"] as const;

export interface UsageBackend {
  findExecutable(): Promise<string | null>;
  /** Builds the child environment once per snapshot; every provider call in
   * the snapshot shares the result. */
  buildEnvironment(): Promise<Record<string, string>>;
  fetch(
    executable: string,
    provider: string,
    timeoutMs: number,
    environment: Record<string, string>,
  ): Promise<unknown>;
}

export class BackendUnavailableError extends Error {
  override name = "BackendUnavailableError";
}

export class BackendTimeoutError extends Error {
  override name = "BackendTimeoutError";
}

export class CodexBarBackend implements UsageBackend {
  async findExecutable(): Promise<string | null> {
    return findCodexBarExecutable(process.env.PATH, process.cwd());
  }

  async buildEnvironment(): Promise<Record<string, string>> {
    return buildBackendEnvironment(process.env, process.cwd());
  }

  async fetch(
    executable: string,
    provider: string,
    timeoutMs: number,
    environment: Record<string, string>,
  ): Promise<unknown> {
    return runCodexBar(executable, provider, timeoutMs, environment);
  }
}

export async function findCodexBarExecutable(
  pathValue: string | undefined,
  forbiddenRoot: string = process.cwd(),
): Promise<string | null> {
  if (!pathValue) {
    return null;
  }

  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) {
      continue;
    }
    const resolved = await validateTrustedExecutable(
      join(directory, CODEXBAR_EXECUTABLE),
      forbiddenRoot,
    );
    if (resolved !== null) {
      return resolved;
    }
  }

  return null;
}

/** Runs the full discovery validation on one candidate and returns its
 * resolved real path, or null when any rule fails: the candidate is
 * resolved through symlinks, must be a regular file owned by the current
 * user or root without group or world write bits, must be executable, and
 * its resolved directory chain must be trusted and outside the forbidden
 * root. */
async function validateTrustedExecutable(
  candidate: string,
  forbiddenRoot: string,
): Promise<string | null> {
  try {
    const resolved = await realpath(candidate);
    const metadata = await stat(resolved);
    if (!metadata.isFile()) {
      return null;
    }
    if (process.platform !== "win32") {
      if ((metadata.mode & 0o022) !== 0) {
        return null;
      }
      if (
        typeof process.getuid === "function" &&
        metadata.uid !== process.getuid() &&
        metadata.uid !== 0
      ) {
        return null;
      }
    }
    if (!(await isTrustedDirectoryChain(dirname(resolved), forbiddenRoot))) {
      return null;
    }
    await access(resolved, constants.X_OK);
    return resolved;
  } catch {
    // Missing, inaccessible, or non-executable candidates are not trusted.
    return null;
  }
}

export async function runCodexBar(
  executable: string,
  provider: string,
  timeoutMs: number,
  environment?: Record<string, string>,
): Promise<unknown> {
  // Resolve the environment first, on both call paths: the trust re-check
  // below is the last thing before the spawn, so a backend swapped while
  // the environment is being built still fails the re-check.
  const childEnvironment = environment ?? await buildBackendEnvironment(
    process.env,
    process.cwd(),
  );
  const resolvedExecutable = await assertExecutableTrusted(
    executable,
    process.cwd(),
  );
  let processHandle: ReturnType<typeof Bun.spawn>;
  const useProcessGroup = process.platform !== "win32";
  try {
    processHandle = Bun.spawn(
      [
        resolvedExecutable,
        "--provider",
        provider,
        "--format",
        "json",
        "--json-only",
      ],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: dirname(resolvedExecutable),
        env: childEnvironment,
        detached: useProcessGroup,
      },
    );
  } catch (error) {
    throw new BackendUnavailableError(
      `CodexBar could not be started: ${errorMessage(error)}`,
    );
  }

  const stdoutStream = processHandle.stdout;
  const stderrStream = processHandle.stderr;
  if (
    !stdoutStream ||
    typeof stdoutStream === "number" ||
    !stderrStream ||
    typeof stderrStream === "number"
  ) {
    signalProcess(processHandle, "SIGKILL", useProcessGroup);
    throw new BackendUnavailableError("CodexBar output pipes were unavailable.");
  }

  const stdoutReader = stdoutStream.getReader();
  const stderrReader = stderrStream.getReader();
  const stdoutPromise = readBounded(
    stdoutReader,
    MAX_OUTPUT_BYTES,
    "stdout",
  );
  const stderrPromise = readBounded(
    stderrReader,
    MAX_OUTPUT_BYTES,
    "stderr",
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      signalProcess(processHandle, "SIGTERM", useProcessGroup);
      reject(new BackendTimeoutError(`CodexBar timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, processHandle.exited]),
      timeoutPromise,
    ]);

    const payload = parseBackendJson(stdout, provider);

    if (exitCode !== 0) {
      if (payload !== null) {
        return payload;
      }
      const detail = boundedErrorDetail(stderr.trim()) || `exit code ${exitCode}`;
      throw new Error(`CodexBar failed for provider ${provider}: ${detail}`);
    }
    if (payload === null) {
      throw new Error(`CodexBar returned empty JSON for provider ${provider}.`);
    }
    return payload;
  } catch (error) {
    if (error instanceof BackendTimeoutError) {
      await Bun.sleep(PROCESS_TERMINATION_GRACE_MS);
    }
    signalProcess(processHandle, "SIGKILL", useProcessGroup);
    // A descendant outside the process group can keep a pipe open forever.
    // Wait for the readers at most a fixed cap; if the cap fires, cancel the
    // streams so the pending reads release and the command can exit.
    const settled = Promise.allSettled([
      stdoutPromise,
      stderrPromise,
      processHandle.exited,
    ]);
    // The cap's timer must be cleared once the race settles, or the
    // scheduled sleep keeps the process alive for the full cap after an
    // ordinary provider error.
    let capTimeout: ReturnType<typeof setTimeout> | undefined;
    const capReached = new Promise<boolean>((resolve) => {
      capTimeout = setTimeout(() => resolve(true), CLEANUP_WAIT_CAP_MS);
    });
    try {
      if (await Promise.race([settled.then(() => false), capReached])) {
        // Release both reader locks, then cancel the streams: that closes
        // the pipe handles, so the pending reads release and the command
        // exits instead of waiting for the escaped descendant.
        stdoutReader.releaseLock();
        stderrReader.releaseLock();
        await Promise.allSettled([
          stdoutStream.cancel().catch(() => undefined),
          stderrStream.cancel().catch(() => undefined),
        ]);
      }
    } finally {
      if (capTimeout) {
        clearTimeout(capTimeout);
      }
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function buildBackendEnvironment(
  environment: NodeJS.ProcessEnv,
  forbiddenRoot: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      continue;
    }
    const canonicalName = name.toUpperCase();
    if (
      FORBIDDEN_ENV_NAMES.has(canonicalName) ||
      FORBIDDEN_ENV_PREFIXES.some((prefix) => canonicalName.startsWith(prefix))
    ) {
      continue;
    }
    result[name] = value;
  }
  result.PATH = await trustedPath(environment.PATH, forbiddenRoot);
  return result;
}

async function trustedPath(
  pathValue: string | undefined,
  forbiddenRoot: string,
): Promise<string> {
  if (!pathValue) {
    return "";
  }
  const directories: string[] = [];
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) {
      continue;
    }
    try {
      const resolved = await realpath(directory);
      if (
        !directories.includes(resolved) &&
        await isTrustedDirectoryChain(resolved, forbiddenRoot)
      ) {
        directories.push(resolved);
      }
    } catch {
      // Missing or untrusted PATH entries are omitted from the child.
    }
  }
  return directories.join(delimiter);
}

/** Re-validates the executable immediately before each spawn by re-running
 * the full discovery validation, and returns the resolved real path to
 * spawn. Discovery runs once per snapshot, so this closes most of the
 * replacement window between discovery and a later spawn; re-resolving
 * here also refuses a path whose file was replaced by a symlink after
 * discovery. */
async function assertExecutableTrusted(
  executable: string,
  forbiddenRoot: string,
): Promise<string> {
  const resolved = await validateTrustedExecutable(executable, forbiddenRoot);
  if (resolved === null) {
    throw new BackendUnavailableError(
      `CodexBar failed its trust re-check immediately before launch: ${executable}`,
    );
  }
  return resolved;
}

async function isTrustedDirectoryChain(
  start: string,
  forbiddenRoot: string,
): Promise<boolean> {
  const resolvedForbiddenRoot = await realpath(resolve(forbiddenRoot));
  let current = await realpath(resolve(start));
  if (isWithin(current, resolvedForbiddenRoot)) {
    return false;
  }

  while (true) {
    const metadata = await stat(current);
    if (!metadata.isDirectory()) {
      return false;
    }
    if (process.platform !== "win32") {
      const currentUid = typeof process.getuid === "function"
        ? process.getuid()
        : metadata.uid;
      if (metadata.uid !== currentUid && metadata.uid !== 0) {
        return false;
      }
      if ((metadata.mode & 0o002) !== 0) {
        return false;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return true;
    }
    current = parent;
  }
}

function isWithin(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (
    !relativePath.startsWith("..") && !isAbsolute(relativePath)
  );
}

function parseBackendJson(stdout: string, provider: string): unknown | null {
  if (!stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(
      `CodexBar returned malformed JSON for provider ${provider}: ${errorMessage(error)}`,
    );
  }
}

function boundedErrorDetail(value: string): string {
  if (value.length <= MAX_ERROR_DETAIL_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_ERROR_DETAIL_CHARS)}…`;
}

function signalProcess(
  processHandle: ReturnType<typeof Bun.spawn>,
  signal: NodeJS.Signals,
  processGroup: boolean,
): void {
  if (processGroup) {
    try {
      process.kill(-processHandle.pid, signal);
      return;
    } catch {
      // The process group may have exited between the timer and signal.
    }
  }
  try {
    processHandle.kill(signal);
  } catch {
    // Signaling an already-exited process is harmless.
  }
}

/** Reads a bounded amount of text from an already-acquired reader. The
 * caller keeps the option to release the lock and cancel the stream when a
 * read can never settle. */
async function readBounded(
  reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>,
  byteLimit: number,
  label: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let value = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > byteLimit) {
        await reader.cancel();
        throw new Error(`CodexBar ${label} exceeded ${byteLimit} bytes.`);
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
