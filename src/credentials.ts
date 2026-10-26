import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** CodexBar treats a Kimi CLI access token as stale this long before its
 * expiry (KimiSettingsReader), so usagemux uses the same margin. */
export const KIMI_STALE_MARGIN_MS = 60_000;

/** Where the Kimi Code CLI keeps its OAuth credential, honoring KIMI_CODE_HOME
 * as the CLI and CodexBar do. */
export function kimiCredentialPath(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
  return join(home, "credentials", "kimi-code.json");
}

function epochMs(value: unknown): number | null {
  const n = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) {
    return null;
  }
  return n > 1e12 ? n : n * 1000;
}

/** True when the Kimi Code CLI credential holds a refresh token and its
 * 15-minute access token is within CodexBar's staleness margin or past it.
 * The CLI refreshes the token on its next run; CodexBar never does. Only the
 * expiry time and the presence of a refresh token are read. A refresh token
 * that the server has revoked looks the same, so callers must not claim the
 * sign-in is valid. */
export function kimiTokenAgedOut(path: string = kimiCredentialPath(), now: number = Date.now()): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object") {
    return false;
  }
  const record = parsed as Record<string, unknown>;
  const expiresMs = epochMs(record.expires_at);
  const hasRefresh = typeof record.refresh_token === "string" && record.refresh_token.length > 0;
  if (expiresMs === null || !hasRefresh) {
    return false;
  }
  return expiresMs - KIMI_STALE_MARGIN_MS <= now;
}
