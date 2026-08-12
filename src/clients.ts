export const SUPPORTED_CLIENTS = [
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
] as const;

export type Client = (typeof SUPPORTED_CLIENTS)[number];

export const CLIENT_PROVIDERS: Readonly<Record<Client, string | null>> = {
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
};

const SUPPORTED_CLIENT_SET = new Set<string>(SUPPORTED_CLIENTS);

export function isSupportedClient(value: string): value is Client {
  return SUPPORTED_CLIENT_SET.has(value);
}

export function getNotApplicableMessage(client: Client): string {
  return `${client} is provider-agnostic; usage depends on its configured provider.`;
}
