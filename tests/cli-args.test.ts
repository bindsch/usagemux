import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs, readPackageVersion } from "../src/cli";

describe("CLI arguments", () => {
  test("defaults snapshot to all clients, including agy, exactly as --all", () => {
    const parsed = parseCliArgs(["snapshot"]);
    expect(parsed.kind).toBe("snapshot");
    if (parsed.kind === "snapshot") {
      expect(parsed.clients).toHaveLength(16);
      expect(parsed.clients).toContain("agy");
      expect(parsed.timeoutMs).toBeUndefined();
      expect(parsed.format).toBe("text");
    }
    const all = parseCliArgs(["snapshot", "--all"]);
    expect(all).toEqual(parsed);
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
