import { describe, expect, test } from "bun:test";

import {
  CLIENT_PROVIDERS,
  DEFAULT_CLIENTS,
  SUPPORTED_CLIENTS,
  getNotApplicableMessage,
  withErrorRemedy,
} from "../src/clients";

describe("client mapping", () => {
  test("supports the exact public client set", () => {
    expect(SUPPORTED_CLIENTS).toEqual([
      "agy",
      "aider",
      "claude",
      "cline",
      "codex",
      "copilot",
      "cursor",
      "droid",
      "goose",
      "gemini",
      "kimi",
      "opencode",
      "openhands",
      "pi",
      "qwen",
      "zai",
    ]);
  });

  test("maps clients to CodexBar providers", () => {
    expect(CLIENT_PROVIDERS).toEqual({
      agy: "antigravity",
      aider: null,
      claude: "claude",
      cline: "clinepass",
      codex: "codex",
      copilot: "copilot",
      cursor: "cursor",
      droid: "factory",
      goose: null,
      gemini: "gemini",
      kimi: "kimi",
      opencode: "opencode",
      openhands: null,
      pi: null,
      qwen: "qwencloud",
      zai: "zai",
    });
  });

  test("explains provider-agnostic clients", () => {
    expect(getNotApplicableMessage("aider")).toBe(
      "aider is provider-agnostic; usage depends on its configured provider.",
    );
    expect(getNotApplicableMessage("openhands")).toBe(
      "openhands is provider-agnostic; usage depends on its configured provider.",
    );
  });
});

describe("error remedies", () => {
  test("appends the copilot remedy to the upstream no-strategy error", () => {
    const message = withErrorRemedy(
      "copilot",
      "No available fetch strategy for copilot.",
    );
    expect(message).toContain("No available fetch strategy for copilot.");
    expect(message).toContain(
      "Add a Copilot account in CodexBar (menu > Add / switch account, GitHub device flow)",
    );
    expect(message).toContain("COPILOT_API_TOKEN");
  });

  test("appends the cline remedy to the upstream no-strategy error", () => {
    const message = withErrorRemedy(
      "cline",
      "No available fetch strategy for clinepass.",
    );
    expect(message).toContain("cline auth");
    expect(message).toContain("Settings > Providers > ClinePass");
  });

  test("falls back to the generic account remedy for other providers", () => {
    expect(
      withErrorRemedy("gemini", "No available fetch strategy for gemini."),
    ).toBe(
      "No available fetch strategy for gemini. Add an account for this provider in CodexBar (menu > Add / switch account).",
    );
  });

  test("appends the agy timeout remedy and a generic one elsewhere", () => {
    expect(withErrorRemedy("agy", "CodexBar timed out after 10000ms.", { timeoutMs: 10_000, ownTimeout: true })).toBe(
      "CodexBar timed out after 10000ms. The Antigravity provider probes the local language server and conversation history; 90 seconds has been enough with the IDE closed. Retry with a longer --timeout (up to 300 seconds) if this provider is expected to answer.",
    );
    expect(withErrorRemedy("codex", "CodexBar timed out after 10000ms.", { timeoutMs: 10_000, ownTimeout: true })).toBe(
      "CodexBar timed out after 10000ms. Retry with a longer --timeout (up to 300 seconds) if this provider is expected to answer.",
    );
  });

  test("leaves other error messages untouched", () => {
    expect(withErrorRemedy("codex", "provider request failed")).toBe(
      "provider request failed",
    );
  });

  test("a timeout that already used the cap says so instead of suggesting a longer one", () => {
    expect(withErrorRemedy("codex", "CodexBar timed out after 300000ms.", { timeoutMs: 300_000, ownTimeout: true })).toBe(
      "CodexBar timed out after 300000ms. The 300-second --timeout cap was already in use, so this provider is not answering.",
    );
  });

  test("the kimi credential remedy names kimi login", () => {
    expect(withErrorRemedy("kimi", "No available fetch strategy for kimi.")).toContain("Run kimi login");
  });

  test("a timeout CodexBar reports inside its own output gets no remedy", () => {
    expect(withErrorRemedy("codex", "CodexBar timed out after 10000ms.")).toBe("CodexBar timed out after 10000ms.");
    expect(withErrorRemedy("codex", "CodexBar timed out after 10000ms.", { ownTimeout: false })).toBe(
      "CodexBar timed out after 10000ms.",
    );
  });

  test("the default client set leaves agy out and keeps every other client", () => {
    expect(DEFAULT_CLIENTS).not.toContain("agy");
    expect(DEFAULT_CLIENTS.length).toBe(SUPPORTED_CLIENTS.length - 1);
  });
});
