export const USAGE_STATUSES = [
  "ok",
  "unavailable",
  "not-applicable",
  "error",
] as const;

export type UsageStatus = (typeof USAGE_STATUSES)[number];

export interface UsageWindow {
  kind: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface UsageCredits {
  remaining: number;
  unit: string;
}

export interface UsageResult {
  client: string;
  provider: string | null;
  status: UsageStatus;
  source: string | null;
  plan: string | null;
  account: string | null;
  windows: UsageWindow[];
  credits: UsageCredits | null;
  subscriptionRenewsAt: string | null;
  subscriptionExpiresAt: string | null;
  message: string | null;
}

export interface UsageSnapshot {
  schemaVersion: "1";
  generatedAt: string;
  results: UsageResult[];
}
