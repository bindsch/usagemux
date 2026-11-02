/** Enforces the per-file coverage floor for `make check`. Reads the lcov
 * report written by `bun test --coverage --coverage-reporter=lcov` and fails
 * when any file under src/ is below the floor on functions or lines, is
 * missing from the report entirely, appears in a record without all four
 * `LF`/`LH`/`FNF`/`FNH` summary lines, carries a counter that is not a
 * non-negative integer, or reports more hit than found lines or functions.
 * The report must also be fresh: written after the run stamp the Makefile
 * touches right before the test run, so a report left behind by an earlier
 * or failed run can never pass. */

import { statSync } from "node:fs";
import { join, resolve } from "node:path";

const MINIMUM_COVERAGE = 0.8;
const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
const SOURCE_GLOB = "src/**/*.{ts,tsx}";
const REPORT_NAME = "lcov.info";
const STAMP_NAME = ".run-stamp";
const SUMMARY_LABELS = ["LF", "LH", "FNF", "FNH"] as const;
type SummaryLabel = (typeof SUMMARY_LABELS)[number];
const REQUIRED_SUMMARIES = new Set<SummaryLabel>(SUMMARY_LABELS);

// src/index.ts is the CLI entry point: tests exercise it through a real
// launcher subprocess, which Bun's in-process reporter cannot measure.
// src/types.ts holds type declarations and one exported constant with no
// branches. Neither can appear in the lcov report; both stay exempt.
const UNMEASURED = new Set(["src/index.ts", "src/types.ts"]);

interface FileCoverage {
  lines: { hit: number; found: number };
  functions: { hit: number; found: number };
  /** The summary keys this record carries; all four are required. */
  summaries: Set<SummaryLabel>;
  /** Summary lines whose value is not a non-negative integer. */
  invalidCounters: string[];
  /** Summary lines repeating a label the record already carried: a second
   * `LH:` could replace a low count with a passing one. */
  duplicateSummaries: string[];
}

/** Returns undefined when the report can gate this run, or a one-line
 * reason to refuse it: the report or the stamp is missing, or the report
 * predates the stamp. Bun writes the report by renaming a temp file onto
 * `lcov.info`, which fails with EPERM where replacing the existing file is
 * forbidden; without this check a report surviving from an earlier run
 * would pass the floor silently. */
export function reportStaleness(coverageDir: string): string | undefined {
  const reportPath = join(coverageDir, REPORT_NAME);
  const stampPath = join(coverageDir, STAMP_NAME);
  const report = statSync(reportPath, { throwIfNoEntry: false });
  if (report === undefined) {
    return `${reportPath} is missing; the test run wrote no coverage report.`;
  }
  const stamp = statSync(stampPath, { throwIfNoEntry: false });
  if (stamp === undefined) {
    return `${stampPath} is missing; run the floor through \`make check\`.`;
  }
  if (report.mtimeMs < stamp.mtimeMs) {
    return `${reportPath} is stale: older than ${stampPath}, so it survived from an earlier run.`;
  }
  return undefined;
}

function ratio({ hit, found }: { hit: number; found: number }): number {
  return found === 0 ? 1 : hit / found;
}

function percent({ hit, found }: { hit: number; found: number }): string {
  return `${(ratio({ hit, found }) * 100).toFixed(2)}% (${hit}/${found})`;
}

/** Parses one summary counter. lcov writes bare decimal digits; anything
 * else (blank, signed, fractional, non-numeric) has no defensible reading,
 * and Number() alone yields NaN or 0, both of which slip past every
 * comparison in the floor. */
function parseCounter(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Reads one summary line into the record. An unreadable counter is kept
 * as-is and still counts as a present summary, so the refusal names the
 * unreadable value instead of a missing line. */
function readSummary(record: FileCoverage, line: string): void {
  const label = SUMMARY_LABELS.find((candidate) =>
    line.startsWith(`${candidate}:`)
  );
  if (label === undefined) {
    return;
  }
  if (record.summaries.has(label)) {
    record.duplicateSummaries.push(line);
    return;
  }
  const value = parseCounter(line.slice(label.length + 1));
  if (value === undefined) {
    record.invalidCounters.push(line);
  } else if (label === "LF") {
    record.lines.found = value;
  } else if (label === "LH") {
    record.lines.hit = value;
  } else if (label === "FNF") {
    record.functions.found = value;
  } else {
    record.functions.hit = value;
  }
  record.summaries.add(label);
}

/** Fails when any file under src/ is below the floor on functions or lines,
 * or is missing from the report entirely. */
async function enforceCoverageFloor(reportPath: string): Promise<void> {
  const report = Bun.file(reportPath);
  if (!(await report.exists())) {
    console.error(
      `${reportPath} is missing; run the tests with the lcov reporter.`,
    );
    process.exit(1);
  }

  const expected = new Set<string>();
  for await (const path of new Bun.Glob(SOURCE_GLOB).scan({
    onlyFiles: true,
    cwd: REPOSITORY_ROOT,
  })) {
    if (!UNMEASURED.has(path)) {
      expected.add(path);
    }
  }

  const coverage = new Map<string, FileCoverage>();
  const summaryless: string[] = [];
  const duplicates: string[] = [];
  let current: FileCoverage | undefined;
  let currentPath: string | undefined;
  // A record without its summaries would score as 100% covered (zeros read
  // as a complete nothing left to cover), so every record must carry all
  // four lines before it can gate anything.
  const finishRecord = (): void => {
    if (
      currentPath !== undefined && current &&
      current.summaries.size < REQUIRED_SUMMARIES.size
    ) {
      summaryless.push(currentPath);
    }
    current = undefined;
    currentPath = undefined;
  };
  for (const line of (await report.text()).split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      finishRecord();
      currentPath = line.slice(3);
      // Two records for one file: a later well-covered record would
      // replace an earlier under-covered or invalid one, so concatenated
      // reports could pass. Bun writes one record per file; refuse the rest.
      if (coverage.has(currentPath)) duplicates.push(currentPath);
      current = {
        lines: { hit: 0, found: 0 },
        functions: { hit: 0, found: 0 },
        summaries: new Set(),
        invalidCounters: [],
        duplicateSummaries: [],
      };
      coverage.set(currentPath, current);
    } else if (line === "end_of_record") {
      finishRecord();
    } else if (current) {
      readSummary(current, line);
    }
  }
  finishRecord();

  const failures: string[] = [];
  for (const path of duplicates) {
    failures.push(`${path}: report carries more than one record for this file`);
  }
  for (const path of summaryless) {
    failures.push(
      `${path}: report record lacks its LF/LH/FNF/FNH summary lines`,
    );
  }
  for (const [path, entry] of coverage) {
    for (const counter of entry.invalidCounters) {
      failures.push(`${path}: ${counter} is not a non-negative integer`);
    }
    for (const summary of entry.duplicateSummaries) {
      failures.push(`${path}: ${summary} repeats a summary line the record already carries`);
    }
    if (entry.invalidCounters.length > 0 || entry.duplicateSummaries.length > 0) {
      // The counters are unreadable; comparing them would invent numbers.
      continue;
    }
    if (entry.lines.hit > entry.lines.found) {
      failures.push(
        `${path}: LH ${entry.lines.hit} exceeds LF ${entry.lines.found}`,
      );
    }
    if (entry.functions.hit > entry.functions.found) {
      failures.push(
        `${path}: FNH ${entry.functions.hit} exceeds FNF ${entry.functions.found}`,
      );
    }
  }
  for (const path of [...expected].sort()) {
    const entry = coverage.get(path);
    if (entry === undefined) {
      failures.push(`${path}: missing from the coverage report`);
      continue;
    }
    console.log(
      `${path}: lines ${percent(entry.lines)}, functions ${percent(entry.functions)}`,
    );
    if (ratio(entry.lines) < MINIMUM_COVERAGE) {
      failures.push(`${path}: line coverage below ${(MINIMUM_COVERAGE * 100)}%`);
    }
    if (ratio(entry.functions) < MINIMUM_COVERAGE) {
      failures.push(
        `${path}: function coverage below ${(MINIMUM_COVERAGE * 100)}%`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`Coverage floor of ${(MINIMUM_COVERAGE * 100)}% not met:`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  const coverageDir = process.argv[2] ?? join(REPOSITORY_ROOT, "coverage");
  const stale = reportStaleness(coverageDir);
  if (stale !== undefined) {
    console.error(stale);
    process.exit(1);
  }
  await enforceCoverageFloor(join(coverageDir, REPORT_NAME));
}
