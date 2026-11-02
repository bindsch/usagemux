import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "..");

/** Repository size rule: every TypeScript file under `src/` and `scripts/`
 * stays within 500 lines. A file that outgrows the ceiling is split into
 * focused modules, not exempted. Lines are counted the way a reader counts
 * them: a final line without a trailing newline still counts. */
const MAX_LINES = 500;
const SOURCE_DIRECTORIES = ["src", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/** Counts lines as a reader does, so a file whose last line lacks a
 * trailing newline is not silently one line under the ceiling. */
function countLines(text: string): number {
  if (text === "") {
    return 0;
  }
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

describe("file size limit", () => {
  test("every TypeScript file under src/ and scripts/ is at most 500 lines", async () => {
    const overLimit: string[] = [];
    for (const directory of SOURCE_DIRECTORIES) {
      for (const extension of SOURCE_EXTENSIONS) {
        const glob = new Bun.Glob(`${directory}/**/*${extension}`);
        // Anchored to the repository, not the caller's cwd: a run from
        // another directory must scan the same files.
        for await (const path of glob.scan({ cwd: REPOSITORY_ROOT, onlyFiles: true })) {
          const lines = countLines(await Bun.file(join(REPOSITORY_ROOT, path)).text());
          if (lines > MAX_LINES) {
            overLimit.push(`${path}: ${lines} lines (limit ${MAX_LINES})`);
          }
        }
      }
    }
    expect(overLimit).toEqual([]);
  });

  test("a final line without a trailing newline still counts", () => {
    // 501 lines and no trailing newline: counting newline characters would
    // report 500 and wrongly pass the ceiling.
    const overLimit = `${"line\n".repeat(500)}line`;
    expect(countLines(overLimit)).toBe(501);
    expect(countLines(overLimit) > MAX_LINES).toBe(true);

    expect(countLines("line\n".repeat(500))).toBe(500);
    expect(countLines("line\nline")).toBe(2);
    expect(countLines("line\n")).toBe(1);
    expect(countLines("line")).toBe(1);
    expect(countLines("")).toBe(0);
  });
});
