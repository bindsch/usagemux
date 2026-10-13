import type { UsageResult, UsageSnapshot } from "./types";

// Provider-supplied strings reach a terminal here. Escape C0/C1 control
// characters and DEL so a hostile or compromised upstream response cannot move
// the cursor, clear the screen, or drive terminal reporting sequences.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const JSON_UNESCAPED_CONTROLS = /[\u007F-\u009F]/g;

export function formatSnapshotJson(snapshot: UsageSnapshot): string {
  // JSON.stringify escapes C0 in strings, but leaves DEL and C1 unchanged.
  // Unicode escapes preserve the original strings when consumers parse JSON.
  return `${JSON.stringify(snapshot, null, 2).replace(
    JSON_UNESCAPED_CONTROLS,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )}\n`;
}

export function escapeForTerminal(value: string): string {
  return value.replace(
    CONTROL_CHARACTERS,
    (character) =>
      `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

export function formatSnapshotText(snapshot: UsageSnapshot): string {
  return `${snapshot.results.flatMap(formatResult).join("\n")}\n`;
}

function formatResult(result: UsageResult): string[] {
  const details = [result.plan, result.account]
    .filter((value): value is string => value !== null)
    .map(escapeForTerminal);
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  const lines = [`${result.client}: ${result.status}${suffix}`];

  if (result.status !== "ok") {
    if (result.message) {
      lines.push(`  ${escapeForTerminal(result.message)}`);
    }
    return lines;
  }

  for (const window of result.windows) {
    const remaining =
      window.remainingPercent === null
        ? "unknown remaining"
        : `${formatNumber(window.remainingPercent)}% remaining`;
    const reset = window.resetsAt === null ? "reset unknown" : `resets ${window.resetsAt}`;
    lines.push(`  ${escapeForTerminal(window.kind)}: ${remaining}; ${reset}`);
  }
  if (result.credits) {
    lines.push(
      `  credits: ${formatNumber(result.credits.remaining)} ${escapeForTerminal(result.credits.unit)} remaining`,
    );
  }
  if (result.subscriptionRenewsAt) {
    lines.push(`  subscription renews: ${result.subscriptionRenewsAt}`);
  }
  if (result.subscriptionExpiresAt) {
    lines.push(`  subscription expires: ${result.subscriptionExpiresAt}`);
  }
  if (
    result.windows.length === 0 &&
    result.credits === null &&
    result.subscriptionRenewsAt === null &&
    result.subscriptionExpiresAt === null
  ) {
    lines.push("  No usage windows reported.");
  }

  return lines;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
