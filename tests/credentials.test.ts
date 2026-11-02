import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KIMI_AGED_OUT_MESSAGE, withErrorRemedy } from "../src/clients";
import { kimiCredentialPath, kimiTokenAgedOut } from "../src/credentials";

const STALE = "Kimi Code CLI credential is invalid or expired. Run kimi to renew it.";
const NOW = Date.parse("2026-10-26T16:00:00Z");

function credentialFile(contents: unknown): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "usagemux-kimi-"));
  const path = join(dir, "kimi-code.json");
  writeFileSync(path, JSON.stringify(contents));
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function agedOut(contents: unknown): boolean {
  const file = credentialFile(contents);
  try {
    return kimiTokenAgedOut(file.path, NOW);
  } finally {
    file.cleanup();
  }
}

describe("Kimi CLI token that aged out", () => {
  test("is recognized from the expiry time and a refresh token", () => {
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 - 60 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 600 })).toBe(false);
    expect(agedOut({ expires_at: NOW / 1000 - 60 })).toBe(false);
    expect(kimiTokenAgedOut("/nonexistent/kimi-code.json", NOW)).toBe(false);
  });

  test("uses CodexBar's 60-second staleness margin", () => {
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 30 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 90 })).toBe(false);
  });

  test("accepts an expiry written as a string or in milliseconds", () => {
    expect(agedOut({ refresh_token: "r", expires_at: String(NOW / 1000 - 60) })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW - 60_000 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: "soon" })).toBe(false);
    expect(agedOut({ refresh_token: "r", expires_at: "" })).toBe(false);
  });

  test("honors KIMI_CODE_HOME", () => {
    expect(kimiCredentialPath({ KIMI_CODE_HOME: "/custom/kimi" })).toBe("/custom/kimi/credentials/kimi-code.json");
    expect(kimiCredentialPath({})).toEndWith(join(".kimi-code", "credentials", "kimi-code.json"));
  });

  test("replaces CodexBar's 'invalid or expired' only for kimi and only when the token aged out", () => {
    expect(withErrorRemedy("kimi", STALE, { kimiAgedOut: true })).toBe(KIMI_AGED_OUT_MESSAGE);
    expect(withErrorRemedy("kimi", STALE, { kimiAgedOut: false })).toBe(STALE);
    expect(withErrorRemedy("claude", STALE, { kimiAgedOut: true })).toBe(STALE);
  });

  test("the replacement does not claim the sign-in is valid and names the real fallback", () => {
    expect(KIMI_AGED_OUT_MESSAGE).not.toContain("login is fine");
    expect(KIMI_AGED_OUT_MESSAGE).not.toContain("kimi login");
    expect(KIMI_AGED_OUT_MESSAGE).toContain("run kimi and sign in when prompted");
  });
});
