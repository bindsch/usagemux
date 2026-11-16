import { describe, expect, test } from "bun:test";

import {
  CLIENT_PROVIDERS,
  CLIENT_TIMEOUT_MS,
  KIMI_AGED_OUT_MESSAGE,
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

  test("gives pi its own pending-verification message", () => {
    expect(getNotApplicableMessage("pi")).toBe(
      "pi usage is not read yet: CodexBar's pi provider is unverified.",
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
    expect(message).toContain("a plain gh auth token cannot authenticate");
    expect(message).not.toContain("COPILOT_API_TOKEN");
  });

  test("appends the cline remedy to the upstream no-strategy error", () => {
    const message = withErrorRemedy(
      "cline",
      "No available fetch strategy for clinepass.",
    );
    expect(message).toContain("CodexBar could not read Cline usage");
    expect(message).not.toContain("cline auth");
    expect(message).toContain("Settings > Providers > ClinePass");
  });

  test("appends the gemini remedy naming CodexBar account or credential configuration", () => {
    expect(
      withErrorRemedy("gemini", "No available fetch strategy for gemini."),
    ).toContain(
      "CodexBar could not read Gemini usage with its available credentials. Configure a Gemini account or credential source in CodexBar.",
    );
  });

  test("falls back to the generic account remedy for other providers", () => {
    expect(
      withErrorRemedy("droid", "No available fetch strategy for factory."),
    ).toContain(
      "CodexBar could not read usage with its available credentials. Configure an account or credential source for this provider in CodexBar",
    );
  });

  test("appends the agy timeout remedy and a generic one elsewhere", () => {
    expect(withErrorRemedy("agy", "CodexBar timed out after 10000ms.", { timeoutMs: 10_000, ownTimeout: true })).toBe(
      "CodexBar timed out after 10000ms. CodexBar's Antigravity provider probes the local language server and conversation history. Retry this client with --client agy --timeout <seconds> (up to 300 seconds) if this provider is expected to answer. --timeout applies to every selected client.",
    );
    expect(withErrorRemedy("codex", "CodexBar timed out after 10000ms.", { timeoutMs: 10_000, ownTimeout: true })).toBe(
      "CodexBar timed out after 10000ms. Retry this client with --client codex --timeout <seconds> (up to 300 seconds) if this provider is expected to answer. --timeout applies to every selected client.",
    );
  });

  test("attributes other error messages without changing their diagnostic", () => {
    expect(withErrorRemedy("codex", "provider request failed")).toBe(
      "CodexBar reported: provider request failed This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.",
    );
  });

  test("a timeout that already used the cap says so instead of suggesting a longer one", () => {
    expect(withErrorRemedy("codex", "CodexBar timed out after 300000ms.", { timeoutMs: 300_000, ownTimeout: true })).toBe(
      "CodexBar timed out after 300000ms. CodexBar did not finish within the 300-second --timeout cap already in use.",
    );
  });

  test("the kimi remedy distinguishes backend credentials from the harness login", () => {
    const message = withErrorRemedy("kimi", "No available fetch strategy for kimi.");
    expect(message).toContain("CodexBar found no Kimi credential it can read");
    expect(message).toContain("Kimi 2.6 stores its login in credentials/kimi-code-env-<id>.json");
    expect(message.match(/says nothing about whether/g)).toHaveLength(1);
    expect(message).toContain("says nothing about whether the harness is signed in");
    expect(message).toContain("Export KIMI_CODE_API_KEY for the codexbar process");
  });

  test("no remedy names kimi login or COPILOT_API_TOKEN", () => {
    const remedies = [
      ...SUPPORTED_CLIENTS.flatMap((client) => [
        withErrorRemedy(
          client,
          `No available fetch strategy for ${CLIENT_PROVIDERS[client] ?? client}.`,
        ),
        withErrorRemedy(client, "CodexBar timed out after 10000ms.", { timeoutMs: 10_000, ownTimeout: true }),
        withErrorRemedy(
          client,
          "The credential is invalid or expired.",
          { kimiAgedOut: true },
        ),
      ]),
      KIMI_AGED_OUT_MESSAGE,
    ];
    for (const remedy of remedies) {
      expect(remedy).not.toContain("kimi login");
      expect(remedy).not.toContain("COPILOT_API_TOKEN");
      expect(remedy).not.toMatch(/(?:run .*|please |must |complete .*|to |and )(?:sign[ -]in|log[ -]?in)/i);
    }
  });

  test("a timeout CodexBar reports inside its own output gets no remedy", () => {
    expect(withErrorRemedy("codex", "CodexBar timed out after 10000ms.")).toBe("CodexBar reported: CodexBar timed out after 10000ms. This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.");
    expect(withErrorRemedy("codex", "CodexBar timed out after 10000ms.", { ownTimeout: false })).toBe(
      "CodexBar reported: CodexBar timed out after 10000ms. This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.",
    );
  });

  test("every client has a default timeout that fits its provider", () => {
    expect(Object.keys(CLIENT_TIMEOUT_MS)).toEqual([...SUPPORTED_CLIENTS]);
    for (const client of SUPPORTED_CLIENTS) {
      expect(CLIENT_TIMEOUT_MS[client]).toBe(client === "agy" ? 90_000 : client === "claude" ? 60_000 : 10_000);
    }
  });

  test("every CodexBar diagnostic gets the same prefix and closing sentence", () => {
    for (const client of SUPPORTED_CLIENTS) {
      for (const diagnostic of [
        "provider request failed", "Try gh auth login.", "Please re-login.",
        "Could not sign in to Cursor", "Please log into your account",
        "EACCES: open /Users/x/credentials/oauth_creds.json",
        "HTTP 429 from https://example.com/oauth/usage",
        "Failed to write debug log in the output directory",
        "\n".repeat(512 * 1024) + "late diagnostic",
      ]) {
        expect(withErrorRemedy(client, diagnostic))
          .toBe(`CodexBar reported: ${diagnostic} This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.`);
        expect(withErrorRemedy(client, diagnostic, { origin: "usagemux" })).toBe(diagnostic);
      }
    }
  });

  test("Kimi keeps the API-key workaround when the stale marker is inconclusive", () => {
    const diagnostic = "Kimi Code CLI credential is invalid or expired. Run kimi to renew it.";
    const message = withErrorRemedy("kimi", diagnostic, { kimiAgedOut: false });
    expect(message).toStartWith(`CodexBar reported: ${diagnostic}`);
    expect(message).toEndWith("This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.");
    expect(message).toContain("Export KIMI_CODE_API_KEY for the codexbar process");
    expect(message).not.toContain("aged out");
  });

  test("Copilot keeps device-flow advice and the original no-strategy suffix", () => {
    const diagnostic = "No available fetch strategy for copilot. Please log in. Request ID: 42.";
    const message = withErrorRemedy("copilot", diagnostic);
    expect(message).toStartWith(`CodexBar reported: ${diagnostic}`);
    expect(message).toEndWith("This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.");
    expect(message).toContain("GitHub device flow");
    expect(message).toContain("a plain gh auth token cannot authenticate");
  });
});
