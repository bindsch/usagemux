import { describe, expect, test } from "bun:test";

import {
  CLIENT_PROVIDERS,
  SUPPORTED_CLIENTS,
  getNotApplicableMessage,
} from "../src/clients";

describe("client mapping", () => {
  test("supports the exact public client set", () => {
    expect(SUPPORTED_CLIENTS).toEqual([
      "aider",
      "claude",
      "cline",
      "codex",
      "copilot",
      "cursor",
      "droid",
      "goose",
      "gemini",
      "opencode",
      "pi",
      "qwen",
      "zai",
    ]);
  });

  test("maps clients to CodexBar providers", () => {
    expect(CLIENT_PROVIDERS).toEqual({
      aider: null,
      claude: "claude",
      cline: "clinepass",
      codex: "codex",
      copilot: "copilot",
      cursor: "cursor",
      droid: "factory",
      goose: null,
      gemini: "gemini",
      opencode: "opencode",
      pi: null,
      qwen: "qwencloud",
      zai: "zai",
    });
  });

  test("explains provider-agnostic clients", () => {
    expect(getNotApplicableMessage("aider")).toBe(
      "aider is provider-agnostic; usage depends on its configured provider.",
    );
  });
});
