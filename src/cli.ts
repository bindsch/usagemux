import { readFileSync } from "node:fs";

import { CodexBarBackend, type UsageBackend } from "./backend";
import {
  SUPPORTED_CLIENTS,
  isSupportedClient,
  type Client,
} from "./clients";
import { formatSnapshotText } from "./format";
import { createSnapshot, determineExitCode } from "./snapshot";

const DEFAULT_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 300;
const USAGE_EXIT_CODE = 64;
const UNEXPECTED_EXIT_CODE = 1;
const PACKAGE_VERSION = readPackageVersion();

export const HELP_TEXT = `Usage:
  usagemux snapshot [--client <client> ...] [--all] [--format json|text] [--timeout <seconds>]

Options:
  --client <client>    Select a client; repeat to select more than one.
  --all                Select all supported clients (the default).
  --format <format>    Output format: text (default) or json.
  --timeout <seconds>  Per-provider timeout, up to ${MAX_TIMEOUT_SECONDS} seconds.
  -h, --help           Show help.
  -v, --version        Show version.

Clients:
  ${SUPPORTED_CLIENTS.join(", ")}
`;

export interface ParsedSnapshotArgs {
  kind: "snapshot";
  clients: Client[];
  format: "json" | "text";
  timeoutMs: number;
}

export type ParsedCliArgs =
  | ParsedSnapshotArgs
  | { kind: "help" }
  | { kind: "version" };

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CliDependencies {
  backend?: UsageBackend;
  now?: () => Date;
  io?: CliIo;
}

export class CliUsageError extends Error {
  override name = "CliUsageError";
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) {
    return { kind: "help" };
  }
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0]!)) {
    return { kind: "version" };
  }
  if (argv[0] !== "snapshot") {
    throw new CliUsageError(
      argv.length === 0
        ? "Missing command; expected snapshot."
        : `Unknown command "${argv[0]}".`,
    );
  }
  if (argv.length === 2 && ["--help", "-h"].includes(argv[1]!)) {
    return { kind: "help" };
  }

  const clients: Client[] = [];
  let all = false;
  let format: "json" | "text" = "text";
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;

    if (argument === "--all") {
      all = true;
      continue;
    }
    if (argument === "--client" || argument.startsWith("--client=")) {
      const value = readOptionValue(argv, index, "--client");
      if (argument === "--client") {
        index += 1;
      }
      if (!isSupportedClient(value)) {
        throw new CliUsageError(`Unsupported client "${value}".`);
      }
      if (!clients.includes(value)) {
        clients.push(value);
      }
      continue;
    }
    if (argument === "--format" || argument.startsWith("--format=")) {
      const value = readOptionValue(argv, index, "--format");
      if (argument === "--format") {
        index += 1;
      }
      if (value !== "json" && value !== "text") {
        throw new CliUsageError(`Unsupported format "${value}".`);
      }
      format = value;
      continue;
    }
    if (argument === "--timeout" || argument.startsWith("--timeout=")) {
      const value = readOptionValue(argv, index, "--timeout");
      if (argument === "--timeout") {
        index += 1;
      }
      timeoutSeconds = Number(value);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new CliUsageError("--timeout must be a number greater than 0.");
      }
      if (timeoutSeconds > MAX_TIMEOUT_SECONDS) {
        throw new CliUsageError(
          `--timeout cannot exceed ${MAX_TIMEOUT_SECONDS} seconds.`,
        );
      }
      continue;
    }
    throw new CliUsageError(`Unknown option "${argument}".`);
  }

  if (all && clients.length > 0) {
    throw new CliUsageError("--all cannot be combined with --client.");
  }

  return {
    kind: "snapshot",
    clients: clients.length > 0 ? clients : [...SUPPORTED_CLIENTS],
    format,
    timeoutMs: timeoutSeconds * 1_000,
  };
}

export async function main(
  argv: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? defaultIo();

  try {
    const parsed = parseCliArgs(argv);
    if (parsed.kind === "help") {
      io.stdout(HELP_TEXT);
      return 0;
    }
    if (parsed.kind === "version") {
      io.stdout(`usagemux ${PACKAGE_VERSION}\n`);
      return 0;
    }

    const snapshot = await createSnapshot(parsed, {
      backend: dependencies.backend ?? new CodexBarBackend(),
      now: dependencies.now,
    });
    io.stdout(
      parsed.format === "json"
        ? `${JSON.stringify(snapshot, null, 2)}\n`
        : formatSnapshotText(snapshot),
    );
    return determineExitCode(snapshot);
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr(`${error.message}\nRun "usagemux --help" for usage.\n`);
      return USAGE_EXIT_CODE;
    }
    io.stderr(`Unexpected error: ${errorMessage(error)}\n`);
    return UNEXPECTED_EXIT_CODE;
  }
}

function readOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const argument = argv[index]!;
  const equalsIndex = argument.indexOf("=");
  const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(`${option} requires a value.`);
  }
  return value;
}

function defaultIo(): CliIo {
  return {
    stdout: (value) => {
      process.stdout.write(value);
    },
    stderr: (value) => {
      process.stderr.write(value);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPackageVersion(): string {
  const packageUrl = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(packageUrl, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string") {
    throw new Error("package.json is missing a string version.");
  }
  return parsed.version;
}
