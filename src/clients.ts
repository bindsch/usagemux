import { kimiTokenAgedOut } from "./credentials";

export const SUPPORTED_CLIENTS = [
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
] as const;

export type Client = (typeof SUPPORTED_CLIENTS)[number];

/** Per-client defaults in milliseconds; an explicit --timeout overrides all. */
export const CLIENT_TIMEOUT_MS: Readonly<Record<Client, number>> = {
  agy: 90_000,
  aider: 10_000,
  claude: 60_000,
  cline: 10_000,
  codex: 10_000,
  copilot: 10_000,
  cursor: 10_000,
  droid: 10_000,
  goose: 10_000,
  gemini: 10_000,
  kimi: 10_000,
  opencode: 10_000,
  openhands: 10_000,
  pi: 10_000,
  qwen: 10_000,
  zai: 10_000,
};

export const CLIENT_PROVIDERS: Readonly<Record<Client, string | null>> = {
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
};

const SUPPORTED_CLIENT_SET = new Set<string>(SUPPORTED_CLIENTS);

export function isSupportedClient(value: string): value is Client {
  return SUPPORTED_CLIENT_SET.has(value);
}

export function getNotApplicableMessage(client: Client): string {
  if (client === "pi") {
    return "pi usage is not read yet: CodexBar's pi provider is unverified.";
  }
  return `${client} is provider-agnostic; usage depends on its configured provider.`;
}

// CodexBar reports "No available fetch strategy for <provider>." when no
// credential source it can use is available. This says nothing about a
// harness's login. "CodexBar timed out after
// Nms." is usagemux's own message (src/backend.ts, BackendTimeoutError) for a
// provider call that exceeded the per-call timeout. Neither names a remedy,
// so usagemux appends one it can stand behind.
const NO_STRATEGY_PREFIX = "No available fetch strategy for";
const KIMI_API_KEY_HINT = "Export KIMI_CODE_API_KEY for the codexbar process to read usage meanwhile.";

const NO_STRATEGY_REMEDIES: Readonly<Partial<Record<Client, string>>> = {
  cline:
    "CodexBar could not read Cline usage with its available credentials. Add a ClinePass API key in CodexBar under Settings > Providers > ClinePass.",
  gemini:
    "CodexBar could not read Gemini usage with its available credentials. Configure a Gemini account or credential source in CodexBar.",
  kimi:
    `CodexBar found no Kimi credential it can read. Kimi 2.6 stores its login in credentials/kimi-code-env-<id>.json. ${KIMI_API_KEY_HINT}`,
  copilot:
    "CodexBar could not read Copilot usage with its available credentials. Add a Copilot account in CodexBar (menu > Add / switch account, GitHub device flow); a plain gh auth token cannot authenticate to the Copilot usage API.",
};

const GENERIC_NO_STRATEGY_REMEDY =
  "CodexBar could not read usage with its available credentials. Configure an account or credential source for this provider in CodexBar (menu > Add / switch account).";

const CODEXBAR_DIAGNOSTIC_NOTE = "This is CodexBar's own diagnostic and says nothing about whether the harness is signed in.";

/** The `--timeout` ceiling, in seconds; src/cli.ts imports it to cap the flag. */
export const MAX_TIMEOUT_SECONDS = 300;

const TIMEOUT_CONTEXT: Readonly<Partial<Record<Client, string>>> = {
  agy: "CodexBar's Antigravity provider probes the local language server and conversation history.",
};

/** The timeout remedy names a step the operator can still take: a longer
 * `--timeout` while one is available, and the plain fact when the run already
 * used the cap. */
function timeoutRemedy(client: Client, timeoutMs: number | undefined): string {
  const context = TIMEOUT_CONTEXT[client];
  const atCap = timeoutMs !== undefined && timeoutMs >= MAX_TIMEOUT_SECONDS * 1000;
  const step = atCap
    ? `CodexBar did not finish within the ${MAX_TIMEOUT_SECONDS}-second --timeout cap already in use.`
    : `Retry this client with --client ${client} --timeout <seconds> (up to ${MAX_TIMEOUT_SECONDS} seconds) if this provider is expected to answer. --timeout applies to every selected client.`;
  return context === undefined ? step : `${context} ${step}`;
}

export interface RemedyOptions {
  /** Default callers supply CodexBar text; local diagnostics opt out explicitly. */
  readonly origin?: "codexbar" | "usagemux";
  /** The effective timeout, including a per-client default. */
  readonly timeoutMs?: number;
  /** True only when usagemux's own backend timeout fired. A timeout CodexBar
   * reports inside its JSON output is CodexBar's internal budget, which a
   * longer `--timeout` does not change, so it gets no remedy. */
  readonly ownTimeout?: boolean;
  /** For tests: whether the Kimi CLI token has aged out (default: read the
   * CLI credential files' expiries). */
  readonly kimiAgedOut?: boolean;
}

// CodexBar's message when the Kimi Code CLI's access token is stale. That token
// lives 15 minutes and only the CLI refreshes it, so the message misleads
// whenever the token simply aged out; usagemux adds context in that case.
const KIMI_STALE_MARKER = "credential is invalid or expired";
export const KIMI_AGED_OUT_MESSAGE =
  "Kimi usage unknown: the Kimi Code CLI's access token lives 15 minutes and has aged out, and CodexBar "
  + "never refreshes it. kimi refreshes it on its next run, so this is not by itself a sign-in problem.";

export function withErrorRemedy(client: Client, message: string, options: RemedyOptions = {}): string {
  if (options.ownTimeout === true) {
    return `${message} ${timeoutRemedy(client, options.timeoutMs)}`;
  }
  if (options.origin === "usagemux") return message;
  let result = `CodexBar reported: ${message}`;
  let remedy: string | undefined;
  if (client === "kimi" && message.includes(KIMI_STALE_MARKER)) {
    remedy = (options.kimiAgedOut ?? kimiTokenAgedOut()) ? KIMI_AGED_OUT_MESSAGE : KIMI_API_KEY_HINT;
  } else if (message.startsWith(NO_STRATEGY_PREFIX)) {
    remedy = NO_STRATEGY_REMEDIES[client] ?? GENERIC_NO_STRATEGY_REMEDY;
  }
  if (remedy !== undefined) result += ` ${remedy}`;
  return `${result} ${CODEXBAR_DIAGNOSTIC_NOTE}`;
}
