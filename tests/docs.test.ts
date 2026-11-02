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
  });

  test("the pi row explains the pending verification", () => {
    expect(providersGuide).toContain("usage reporting is not yet verified");
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
