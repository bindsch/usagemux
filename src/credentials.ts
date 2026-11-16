import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** CodexBar treats a Kimi CLI access token as stale this long before its
 * expiry (KimiSettingsReader), so usagemux uses the same margin. */
export const KIMI_STALE_MARGIN_MS = 60_000;
export const MAX_CREDENTIAL_ENTRIES = 256;
export const MAX_CREDENTIAL_BYTES = 64 * 1024;

/** Where the Kimi Code CLI keeps its OAuth credentials, honoring KIMI_CODE_HOME
 * as the CLI and CodexBar do. */
export function kimiCredentialDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
  return join(home, "credentials");
}

function epochMs(value: unknown): number | null {
  const n = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) {
    return null;
  }
  return n > 1e12 ? n : n * 1000;
}

/** Resolve directory aliases once and read matching regular files in sorted
 * order. Cap enumeration before sorting; a partial scan cannot prove staleness. */
function credentialFiles(directory: string): string[] {
  const canonical = realpathSync(directory);
  const entries = opendirSync(canonical);
  const paths: string[] = [];
  try {
    let count = 0;
    for (let entry = entries.readSync(); entry !== null; entry = entries.readSync()) {
      if (++count > MAX_CREDENTIAL_ENTRIES) return [];
      if (!/^kimi-code.*\.json$/.test(entry.name)) continue;
      // A matching name that is a link or not a regular file is a credential
      // this scan cannot read, so the scan is incomplete.
      // lstat, not the directory entry type: some filesystems report no type.
      const path = join(canonical, entry.name);
      if (!lstatSync(path).isFile()) return [];
      paths.push(path);
    }
  } finally {
    entries.closeSync();
  }
  return paths.sort();
}

function readCredential(path: string): Record<string, unknown> | null {
  // NOFOLLOW closes the file-symlink swap race. NONBLOCK prevents a swapped
  // FIFO from blocking before fstat rejects it. Bound reads even if it grows.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let parsed: unknown;
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.size > MAX_CREDENTIAL_BYTES) return null;
    const buffer = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > MAX_CREDENTIAL_BYTES) return null;
    parsed = JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally {
    closeSync(fd);
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null;
}

/** True only if a refresh-bearing token aged out and no file has a fresh
 * expiry, including files without refresh tokens. Tokens are never emitted.
 * Invalid, unreadable, oversized, or incompletely scanned files make the
 * result inconclusive (false). A refresh token does not prove a valid login. */
export function kimiTokenAgedOut(directory: string = kimiCredentialDirectory(), now: number = Date.now()): boolean {
  let agedOut = false;
  try {
    for (const path of credentialFiles(directory)) {
      const record = readCredential(path);
      if (record === null) return false;
      const expiresMs = epochMs(record.expires_at);
      if (expiresMs === null) return false;
      if (expiresMs - KIMI_STALE_MARGIN_MS > now) return false;
      if (typeof record.refresh_token === "string" && record.refresh_token.length > 0) {
        agedOut = true;
      }
    }
  } catch {
    return false;
  }
  return agedOut;
}
