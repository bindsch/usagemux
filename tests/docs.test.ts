import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Collapse line wraps so the assertions match phrases as rendered.
function collapse(document: string): string {
  return document.replace(/\s+/g, " ");
}

const repositoryRoot = resolve(import.meta.dir, "..");
const providersGuide = collapse(
  readFileSync(resolve(repositoryRoot, "docs", "PROVIDERS.md"), "utf8"),
);
const developmentGuide = collapse(
  readFileSync(resolve(repositoryRoot, "docs", "DEVELOPMENT.md"), "utf8"),
);
const protocolGuide = collapse(
  readFileSync(resolve(repositoryRoot, "docs", "PROTOCOL.md"), "utf8"),
);
const coverageScript = readFileSync(
  resolve(repositoryRoot, "scripts", "check-source-coverage.ts"),
  "utf8",
);

describe("documentation invariants", () => {
  test("credential advice never names kimi login or COPILOT_API_TOKEN", () => {
    expect(providersGuide).not.toContain("kimi login");
    expect(providersGuide).not.toContain("COPILOT_API_TOKEN");
    expect(providersGuide).not.toMatch(/Run `(?:kimi|gemini)` and|run `cline auth`/);
    expect(providersGuide).toContain("credentials/kimi-code-env-<id>.json");
    expect(providersGuide).not.toContain("This says nothing about whether kimi is signed in");
  });

  test("current docs agree on default selection and timeouts", () => {
    for (const path of ["README.md", "docs/CLI.md", "docs/BACKEND.md"]) {
      const document = collapse(readFileSync(resolve(repositoryRoot, path), "utf8"));
      expect(document).toMatch(/10 seconds generally, 60 for `claude`, and 90 for `agy`/);
      expect(document).not.toContain("except `agy`");
    }
    expect(providersGuide).toContain("Default selection is identical to `--all`, including `agy`");
  });

  test("release docs preserve diagnostics and describe conservative canonical credential scans", () => {
    for (const path of ["README.md", "docs/PROTOCOL.md", "docs/PROVIDERS.md", "CHANGELOG.md"]) {
      const document = collapse(readFileSync(resolve(repositoryRoot, path), "utf8"));
      expect(document).toContain("`CodexBar reported: `");
      expect(document).toContain("This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.");
      expect(document).not.toMatch(/are replaced with|rejects symlinked directories|directory paths are rejected/);
    }
    expect(protocolGuide).toContain("missing/unreadable `expires_at`");
    expect(protocolGuide).toContain("directory symlinks and ancestor aliases are accepted");
    expect(providersGuide).toContain("Every matching regular file must have a readable `expires_at`");
    expect(providersGuide).toContain("inconclusive or finds a fresh token");
  });

  test("the pi row explains the pending verification", () => {
    expect(providersGuide).toContain("usage reporting is not yet verified");
  });

  test("attribution and unconditional closing sentences are documented precisely", () => {
    for (const path of ["README.md", "docs/PROTOCOL.md", "docs/PROVIDERS.md", "CHANGELOG.md"]) {
      const document = collapse(readFileSync(resolve(repositoryRoot, path), "utf8"));
      expect(document).toContain("usagemux's own diagnostics have no attribution prefix");
      expect(document).toContain("regardless of diagnostic wording");
      expect(document).not.toContain("8,192 characters");
      expect(document).toContain("failed-process stderr");
    }
    expect(protocolGuide).toContain("`BackendProcessError`");
    expect(protocolGuide).toContain("usagemux's own diagnostics receive no such sentence.");
  });

  test("the not-applicable definition covers both of its causes", () => {
    const sentence = protocolGuide.match(/`not-applicable`:[^.]*\./);
    expect(sentence).not.toBeNull();
    expect(sentence![0]).toContain("provider-agnostic");
    expect(sentence![0]).toContain("`pi`");
  });

  test("the coverage-floor exemptions the guide names match the script's", () => {
    const setLiteral = coverageScript.match(
      /const UNMEASURED = new Set\(\[([^\]]*)\]\)/,
    );
    expect(setLiteral).not.toBeNull();
    const scripted = new Set(
      [...setLiteral![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!),
    );

    // The exemption list ends at the colon; the paths themselves contain
    // periods, so a sentence-boundary match would stop inside them.
    const exemptionList = developmentGuide.match(/The floor exempts ([^:]+):/);
    expect(exemptionList).not.toBeNull();
    const named = new Set(
      [...exemptionList![1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
    );

    expect(named).toEqual(scripted);
  });
});
