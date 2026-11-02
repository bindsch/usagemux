import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
const FIXTURES = resolve(import.meta.dir, "fixtures");

/** Lists every file under the fixture tree, relative to the repository
 * root. Finder droppings are skipped; everything else is a fixture a test
 * may read. */
function fixtureFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name !== ".DS_Store") {
        files.push(relative(REPOSITORY_ROOT, path));
      }
    }
  };
  walk(FIXTURES);
  return files.sort();
}

describe("test fixtures", () => {
  test("no fixture file is matched by an ignore rule", () => {
    const files = fixtureFiles();
    expect(files.length).toBeGreaterThan(0);
    // git check-ignore names the paths an ignore rule matches and exits 0;
    // with no match it exits 1. A fixture an ignore rule catches never
    // reaches a fresh clone, so the tests reading it fail there with ENOENT
    // (tests/fixtures/coverage/ once caught the coverage/ rule this way).
    const result = Bun.spawnSync({
      cmd: ["git", "check-ignore", "--", ...files],
      cwd: REPOSITORY_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const ignored = new TextDecoder().decode(result.stdout).trim();
    expect(ignored).toBe("");
    // Outside a git repository (an unpacked source archive) git exits 128
    // and knows no ignore rules; the rule it checks cannot bite there.
    const stderr = new TextDecoder().decode(result.stderr);
    if (result.exitCode === 128 && /not a git repository/i.test(stderr)) return;
    expect(result.exitCode).toBe(1);
  });
});
