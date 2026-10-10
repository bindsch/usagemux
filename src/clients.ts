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

/** The clients a bare `usagemux snapshot` reads. `agy` is opt-in: its
 * CodexBar provider probes the Antigravity language server and can outlast
 * the 10-second default timeout, which would turn every default snapshot
 * into a wait plus an error (review um2). `--all` or `--client agy` reads it. */
export const DEFAULT_CLIENTS: readonly Client[] = SUPPORTED_CLIENTS.filter(
  (client) => client !== "agy",
);

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
  return `${client} is provider-agnostic; usage depends on its configured provider.`;
}

// CodexBar reports "No available fetch strategy for <provider>." when no
// credential source is configured for a provider. "CodexBar timed out after
// Nms." is usagemux's own message (src/backend.ts, BackendTimeoutError) for a
// provider call that exceeded the per-call timeout. Neither names a remedy,
// so usagemux appends one it can stand behind.
const NO_STRATEGY_PREFIX = "No available fetch strategy for";
const TIMEOUT_PREFIX = "CodexBar timed out after";

const NO_STRATEGY_REMEDIES: Readonly<Partial<Record<Client, string>>> = {
  cline:
    "Install the Cline CLI and run cline auth, or add a ClinePass API key in CodexBar under Settings > Providers > ClinePass.",
  kimi:
    "Run kimi login (CodexBar reads the Kimi Code CLI's own credential and does not refresh it), or export KIMI_CODE_API_KEY for the codexbar process.",
  copilot:
    "Add a Copilot account in CodexBar (menu > Add / switch account, GitHub device flow) or export COPILOT_API_TOKEN for the codexbar process; a plain gh auth token cannot authenticate to the Copilot usage API.",
};

const GENERIC_NO_STRATEGY_REMEDY =
  "Add an account for this provider in CodexBar (menu > Add / switch account).";

/** The `--timeout` ceiling, in seconds; src/cli.ts imports it to cap the flag. */
export const MAX_TIMEOUT_SECONDS = 300;

const TIMEOUT_CONTEXT: Readonly<Partial<Record<Client, string>>> = {
  agy: "The Antigravity provider probes the local language server and conversation history; 90 seconds has been enough with the IDE closed.",
};

/** The timeout remedy names a step the operator can still take: a longer
 * `--timeout` while one is available, and the plain fact when the run already
 * used the cap. */
function timeoutRemedy(client: Client, timeoutMs: number | undefined): string {
  const context = TIMEOUT_CONTEXT[client];
  const atCap = timeoutMs !== undefined && timeoutMs >= MAX_TIMEOUT_SECONDS * 1000;
  const step = atCap
    ? `The ${MAX_TIMEOUT_SECONDS}-second --timeout cap was already in use, so this provider is not answering.`
    : `Retry with a longer --timeout (up to ${MAX_TIMEOUT_SECONDS} seconds) if this provider is expected to answer.`;
  return context === undefined ? step : `${context} ${step}`;
}

export interface RemedyOptions {
  /** The `--timeout` this run used, for the cap-aware timeout remedy. */
  readonly timeoutMs?: number;
  /** True only when usagemux's own backend timeout fired. A timeout CodexBar
   * reports inside its JSON output is CodexBar's internal budget, which a
   * longer `--timeout` does not change, so it gets no remedy (review um2). */
  readonly ownTimeout?: boolean;
}

export function withErrorRemedy(client: Client, message: string, options: RemedyOptions = {}): string {
  let remedy: string | undefined;
  if (message.startsWith(NO_STRATEGY_PREFIX)) {
    remedy = NO_STRATEGY_REMEDIES[client] ?? GENERIC_NO_STRATEGY_REMEDY;
  } else if (message.startsWith(TIMEOUT_PREFIX) && options.ownTimeout === true) {
    remedy = timeoutRemedy(client, options.timeoutMs);
  }
  return remedy === undefined ? message : `${message} ${remedy}`;
}
