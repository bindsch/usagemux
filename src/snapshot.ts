import {
  CLIENT_PROVIDERS,
  getNotApplicableMessage,
  type Client,
} from "./clients";
import {
  BackendUnavailableError,
  type UsageBackend,
} from "./backend";
import { normalizeCodexBarPayload } from "./normalize";
import type { UsageResult, UsageSnapshot } from "./types";

export { BackendUnavailableError } from "./backend";
export type { UsageBackend } from "./backend";

export interface SnapshotOptions {
  clients: Client[];
  timeoutMs: number;
}

export interface SnapshotDependencies {
  backend: UsageBackend;
  now?: () => Date;
}

export async function createSnapshot(
  options: SnapshotOptions,
  dependencies: SnapshotDependencies,
): Promise<UsageSnapshot> {
  const now = dependencies.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const applicableClients = options.clients.filter(
    (client) => CLIENT_PROVIDERS[client] !== null,
  );

  if (applicableClients.length === 0) {
    return {
      schemaVersion: "1",
      generatedAt,
      results: options.clients.map(notApplicableResult),
    };
  }

  const executable = await dependencies.backend.findExecutable();
  if (executable === null) {
    return {
      schemaVersion: "1",
      generatedAt,
      results: options.clients.map((client) =>
        CLIENT_PROVIDERS[client] === null
          ? notApplicableResult(client)
          : unavailableResult(
              client,
              CLIENT_PROVIDERS[client],
              "CodexBar was not found on PATH.",
            ),
      ),
    };
  }

  const results = await Promise.all(
    options.clients.map((client) =>
      collectClientResult(
        client,
        executable,
        options.timeoutMs,
        dependencies.backend,
      ),
    ),
  );

  return { schemaVersion: "1", generatedAt, results };
}

export function determineExitCode(snapshot: UsageSnapshot): 0 | 69 {
  const applicable = snapshot.results.filter(
    ({ status }) => status !== "not-applicable",
  );
  return applicable.length > 0 &&
    applicable.every(({ status }) => status === "unavailable")
    ? 69
    : 0;
}

async function collectClientResult(
  client: Client,
  executable: string,
  timeoutMs: number,
  backend: UsageBackend,
): Promise<UsageResult> {
  const provider = CLIENT_PROVIDERS[client];
  if (provider === null) {
    return notApplicableResult(client);
  }

  try {
    const payload = await backend.fetch(executable, provider, timeoutMs);
    return normalizeCodexBarPayload(payload, { client, provider });
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof BackendUnavailableError) {
      return unavailableResult(client, provider, message);
    }
    return errorResult(client, provider, message);
  }
}

function notApplicableResult(client: Client): UsageResult {
  return {
    client,
    provider: null,
    status: "not-applicable",
    source: null,
    plan: null,
    account: null,
    windows: [],
    credits: null,
    subscriptionRenewsAt: null,
    subscriptionExpiresAt: null,
    message: getNotApplicableMessage(client),
  };
}

function unavailableResult(
  client: Client,
  provider: string,
  message: string,
): UsageResult {
  return {
    client,
    provider,
    status: "unavailable",
    source: null,
    plan: null,
    account: null,
    windows: [],
    credits: null,
    subscriptionRenewsAt: null,
    subscriptionExpiresAt: null,
    message,
  };
}

function errorResult(
  client: Client,
  provider: string,
  message: string,
): UsageResult {
  return {
    client,
    provider,
    status: "error",
    source: "codexbar",
    plan: null,
    account: null,
    windows: [],
    credits: null,
    subscriptionRenewsAt: null,
    subscriptionExpiresAt: null,
    message,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
