import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KIMI_AGED_OUT_MESSAGE, withErrorRemedy } from "../src/clients";
import { kimiCredentialDirectory, kimiTokenAgedOut, MAX_CREDENTIAL_BYTES } from "../src/credentials";

const STALE = "Kimi Code CLI credential is invalid or expired. Run kimi to renew it.";
const NOW = Date.parse("2026-10-26T16:00:00Z");

function credentialDirectory(contents: unknown): { directory: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kimi-"));
  const path = join(dir, "kimi-code.json");
  writeFileSync(path, JSON.stringify(contents));
  return { directory: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function agedOut(contents: unknown): boolean {
  const fixture = credentialDirectory(contents);
  try {
    return kimiTokenAgedOut(fixture.directory, NOW);
  } finally {
    fixture.cleanup();
  }
}

describe("Kimi CLI token that aged out", () => {
  test("creates credential fixtures in system temp without writing to the checkout", () => {
    const fixture = credentialDirectory({});
    try {
      expect(fixture.directory.startsWith(join(tmpdir(), "kimi-"))).toBe(true);
    } finally { fixture.cleanup(); }
  });

  test("is recognized from the expiry time and a refresh token", () => {
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 - 60 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 600 })).toBe(false);
    expect(agedOut({ expires_at: NOW / 1000 - 60 })).toBe(false);
    expect(kimiTokenAgedOut("/nonexistent/credentials", NOW)).toBe(false);
  });

  test("uses CodexBar's 60-second staleness margin", () => {
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 30 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 60 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW + 60_001 })).toBe(false);
    expect(agedOut({ refresh_token: "r", expires_at: NOW / 1000 + 90 })).toBe(false);
  });

  test("accepts an expiry written as a string or in milliseconds", () => {
    expect(agedOut({ refresh_token: "r", expires_at: String(NOW / 1000 - 60) })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: NOW - 60_000 })).toBe(true);
    expect(agedOut({ refresh_token: "r", expires_at: "soon" })).toBe(false);
    expect(agedOut({ refresh_token: "r", expires_at: "" })).toBe(false);
  });

  test("honors KIMI_CODE_HOME", () => {
    expect(kimiCredentialDirectory({ KIMI_CODE_HOME: "/custom/kimi" })).toBe("/custom/kimi/credentials");
    expect(kimiCredentialDirectory({})).toEndWith(join(".kimi-code", "credentials"));
  });

  test("preserves CodexBar's diagnostic and adds aged-out context only for an aged-out Kimi token", () => {
    const message = withErrorRemedy("kimi", STALE, { kimiAgedOut: true });
    expect(message).toStartWith(`CodexBar reported: ${STALE}`);
    expect(message).toContain(KIMI_AGED_OUT_MESSAGE);
    expect(message).toEndWith("This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.");
    expect(withErrorRemedy("kimi", STALE, { kimiAgedOut: false })).not.toContain("aged out");
    expect(withErrorRemedy("claude", STALE, { kimiAgedOut: true })).not.toContain("aged out");
  });

  test("the added context does not claim a valid login or advise signing in", () => {
    expect(KIMI_AGED_OUT_MESSAGE).not.toContain("login is fine");
    expect(KIMI_AGED_OUT_MESSAGE).not.toContain("kimi login");
    expect(KIMI_AGED_OUT_MESSAGE).not.toContain("run kimi and sign in when prompted");
    expect(KIMI_AGED_OUT_MESSAGE).toEndWith("this is not by itself a sign-in problem.");
  });

  test("reads Kimi 2.6 environment credentials beside an expired legacy file without a refresh token", () => {
    const fixture = credentialDirectory({ access_token: "", refresh_token: "", expires_at: NOW });
    const envPath = join(fixture.directory, "kimi-code-env-0123456789abcdef.json");
    try {
      writeFileSync(envPath, JSON.stringify({ refresh_token: "r", expires_at: NOW - 60_000 }));
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(true);
      writeFileSync(envPath, JSON.stringify({ refresh_token: "r", expires_at: NOW + 600_000 }));
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
    } finally { fixture.cleanup(); }
  });

  test("a missing or unreadable expiry makes mixed legacy and environment credentials inconclusive", () => {
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW });
    const envPath = join(fixture.directory, "kimi-code-env-0123456789abcdef.json");
    try {
      for (const expires_at of [undefined, null, "", "soon", {}, []]) {
        const unknown = { refresh_token: "r", expires_at };
        const stale = { refresh_token: "r", expires_at: NOW };
        for (const [legacy, environment] of [[stale, unknown], [unknown, stale]]) {
          writeFileSync(join(fixture.directory, "kimi-code.json"), JSON.stringify(legacy));
          writeFileSync(envPath, JSON.stringify(environment));
          expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
        }
      }
    } finally { fixture.cleanup(); }
  });

  test("any fresh file suppresses stale-token advice, even without a refresh token", () => {
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW - 60_000 });
    try {
      const fresh = { expires_at: NOW + 600_000 };
      writeFileSync(join(fixture.directory, "kimi-code-env-ffffffffffffffff.json"), JSON.stringify(fresh));
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
      // Also put freshness after the stale entry in lexical order.
      writeFileSync(join(fixture.directory, "kimi-code-env-ffffffffffffffff.json"), JSON.stringify({ refresh_token: "r", expires_at: NOW }));
      writeFileSync(join(fixture.directory, "kimi-code.json"), JSON.stringify(fresh));
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
    } finally { fixture.cleanup(); }
  });

  test("a matching link or directory makes the scan inconclusive; unrelated files are ignored", () => {
    const fixture = credentialDirectory({ expires_at: NOW });
    try {
      const target = join(fixture.directory, "unrelated.json");
      writeFileSync(target, JSON.stringify({ refresh_token: "r", expires_at: NOW }));
      writeFileSync(join(fixture.directory, "kimi-code.json"), JSON.stringify({ refresh_token: "r", expires_at: NOW }));
      // The unrelated regular file is never read: the stale legacy file decides.
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(true);
      // A linked env credential may hold a fresh token the scan cannot see.
      const link = join(fixture.directory, "kimi-code-env-link.json");
      symlinkSync(target, link);
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
      rmSync(link);
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(true);
      mkdirSync(join(fixture.directory, "kimi-code-directory.json"));
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
    } finally { fixture.cleanup(); }
  });

  test("directory and ancestor symlinks give the same answer as the canonical path", () => {
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW });
    const alias = join(fixture.directory, "alias");
    try {
      symlinkSync(fixture.directory, alias);
      mkdirSync(join(fixture.directory, "credentials"));
      for (const expires_at of [NOW, NOW + 600_000]) {
        const record = JSON.stringify({ refresh_token: "r", expires_at });
        writeFileSync(join(fixture.directory, "kimi-code.json"), record);
        writeFileSync(join(fixture.directory, "credentials", "kimi-code.json"), record);
        const expected = expires_at === NOW;
        expect(kimiTokenAgedOut(realpathSync(fixture.directory), NOW)).toBe(expected);
        expect(kimiTokenAgedOut(alias, NOW)).toBe(expected);
        expect(kimiTokenAgedOut(join(alias, "credentials"), NOW)).toBe(expected);
      }
    } finally { fixture.cleanup(); }
  });

  test("does not infer staleness from malformed or oversized files", () => {
    for (const contents of [null, [], "not an object"]) expect(agedOut(contents)).toBe(false);
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW });
    try {
      const other = join(fixture.directory, "kimi-code-env-bad.json");
      writeFileSync(other, "{");
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
      writeFileSync(other, " ".repeat(MAX_CREDENTIAL_BYTES + 1));
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
    } finally { fixture.cleanup(); }
  });

  test("scans 256 directory entries and refuses 257 even when a full scan would return true", () => {
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW });
    try {
      for (let i = 1; i < 256; i++) writeFileSync(join(fixture.directory, `other-${i}`), "");
      expect(fs.readdirSync(fixture.directory)).toHaveLength(256);
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(true);
      writeFileSync(join(fixture.directory, "kimi-code-extra.json"), JSON.stringify({ refresh_token: "r", expires_at: NOW }));
      expect(fs.readdirSync(fixture.directory)).toHaveLength(257);
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
    } finally { fixture.cleanup(); }
  });

  test("opens matching credentials in sorted order", () => {
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW });
    const paths = ["kimi-code-z.json", "kimi-code-a.json", "kimi-code.json"].map(name => join(fixture.directory, name));
    for (const path of paths) writeFileSync(path, JSON.stringify({ refresh_token: "r", expires_at: NOW }));
    const opened = spyOn(fs, "openSync");
    try {
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(true);
      expect(opened.mock.calls.map(call => call[0])).toEqual(paths.map(path => realpathSync(path)).sort());
    } finally { opened.mockRestore(); fixture.cleanup(); }
  });

  test("refuses a file replaced by a symlink after directory enumeration", () => {
    const fixture = credentialDirectory({});
    const path = join(realpathSync(fixture.directory), "kimi-code.json");
    const target = join(fixture.directory, "other.json");
    writeFileSync(target, JSON.stringify({ refresh_token: "r", expires_at: NOW }));
    const open = fs.openSync;
    const opened = spyOn(fs, "openSync").mockImplementation((name, flags, mode) => {
      if (name === path) {
        renameSync(path, join(fixture.directory, "original.json"));
        symlinkSync(target, path);
      }
      return open(name, flags, mode);
    });
    try {
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(false);
      expect(opened).toHaveBeenCalledTimes(1);
    } finally { opened.mockRestore(); fixture.cleanup(); }
  });
  test("a directory entry with no reported type is still read as a regular file", () => {
    // Some filesystems report DT_UNKNOWN, so Dirent.isFile() is false for a regular file.
    const fixture = credentialDirectory({ refresh_token: "r", expires_at: NOW });
    const real = fs.opendirSync;
    const opened = spyOn(fs, "opendirSync").mockImplementation(((path: fs.PathLike) => {
      const directory = real(path);
      return {
        readSync: () => {
          const entry = directory.readSync();
          return entry === null ? null : { name: entry.name, isFile: () => false };
        },
        closeSync: () => directory.closeSync(),
      };
    }) as unknown as typeof fs.opendirSync);
    try {
      expect(kimiTokenAgedOut(fixture.directory, NOW)).toBe(true);
    } finally {
      opened.mockRestore();
      fixture.cleanup();
    }
  });
});
