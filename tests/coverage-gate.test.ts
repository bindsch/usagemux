import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reportStaleness } from "../scripts/check-source-coverage";

const FIXTURES = resolve(import.meta.dir, "fixtures", "lcov");
const REPOSITORY_ROOT = resolve(import.meta.dir, "..");

// Fixed epochs keep the freshness scenarios deterministic: no sleeps, and
// the outcome never depends on filesystem timestamp resolution.
const STAMP_SECOND = 1_700_000_000;

const gateDirectories: string[] = [];

/** Builds a gate directory holding a copy of a fixture report and a run
 * stamp: the stamp is dated at STAMP_SECOND, the report at STAMP_SECOND
 * plus the offset in seconds. */
function buildGate(
  reportOffsetSeconds: number,
  reportFixture: string = "lcov.info",
): string {
  const directory = mkdtempSync(join(tmpdir(), "usagemux-coverage-gate-"));
  gateDirectories.push(directory);
  const report = join(directory, "lcov.info");
  const stamp = join(directory, ".run-stamp");
  copyFileSync(join(FIXTURES, reportFixture), report);
  writeFileSync(stamp, "");
  utimesSync(stamp, STAMP_SECOND, STAMP_SECOND);
  const reportSecond = STAMP_SECOND + reportOffsetSeconds;
  utimesSync(report, reportSecond, reportSecond);
  return directory;
}

afterEach(() => {
  while (gateDirectories.length > 0) {
    rmSync(gateDirectories.pop()!, { recursive: true, force: true });
  }
});

/** Runs the gate script against a gate directory and returns its exit code
 * and stderr. */
function runGate(
  directory: string,
): { exitCode: number; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      resolve(REPOSITORY_ROOT, "scripts", "check-source-coverage.ts"),
      directory,
    ],
    cwd: REPOSITORY_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("coverage gate freshness", () => {
  test("a report written after the stamp passes", () => {
    expect(reportStaleness(buildGate(5))).toBeUndefined();
  });

  test("a report written in the same second as the stamp passes", () => {
    // Coarse filesystems give one-second timestamp resolution; a report
    // from the gated run itself must not be refused over a shared second.
    expect(reportStaleness(buildGate(0))).toBeUndefined();
  });

  test("a report older than the stamp is refused as stale", () => {
    expect(reportStaleness(buildGate(-5))).toContain("stale");
  });

  test("a missing report is refused", () => {
    const directory = buildGate(5);
    rmSync(join(directory, "lcov.info"));
    expect(reportStaleness(directory)).toContain("missing");
  });

  test("a missing stamp is refused", () => {
    const directory = buildGate(5);
    rmSync(join(directory, ".run-stamp"));
    expect(reportStaleness(directory)).toContain("missing");
  });

  test("the script exits 1 on a stale report", () => {
    const { exitCode, stderr } = runGate(buildGate(-5));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("stale");
  });

  test("the script exits 1 on a record without summary lines", () => {
    const { exitCode, stderr } = runGate(
      buildGate(5, "missing-summaries.lcov"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LF/LH/FNF/FNH");
  });

  test("the script exits 1 on a counter that is not a number", () => {
    const { exitCode, stderr } = runGate(buildGate(5, "nan-counter.lcov"));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LH:garbage is not a non-negative integer");
  });

  test("the script exits 1 on a negative counter", () => {
    const { exitCode, stderr } = runGate(
      buildGate(5, "negative-counter.lcov"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LH:-1 is not a non-negative integer");
  });

  test("the script exits 1 on a blank counter", () => {
    const { exitCode, stderr } = runGate(buildGate(5, "blank-counter.lcov"));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LH: is not a non-negative integer");
  });

  test("the script exits 1 on two records for one file, whatever the later one says", () => {
    const { exitCode, stderr } = runGate(
      buildGate(5, "duplicate-record.lcov"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("more than one record for this file");
  });

  test("the script exits 1 on a repeated summary line inside one record", () => {
    const { exitCode, stderr } = runGate(
      buildGate(5, "duplicate-summary.lcov"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LH:2 repeats a summary line");
  });

  test("the script exits 1 when hit counts exceed found counts", () => {
    const { exitCode, stderr } = runGate(
      buildGate(5, "hits-exceed-found.lcov"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LH 3 exceeds LF 2");
  });
});
