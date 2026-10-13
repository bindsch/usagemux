---
read_when:
  - Integrating with JSON output or changing normalization.
---

# JSON protocol v1

[CLI syntax and exit codes](CLI.md) are documented separately.
After completed snapshot collection, JSON mode writes one object to stdout,
with two-space indentation and a trailing newline. Pre-snapshot failures may
produce no JSON. Exit zero does not imply successful provider measurements.

## Envelope and fields

```json
{
  "schemaVersion": "1",
  "generatedAt": "2026-08-03T10:00:00.000Z",
  "results": [
    {
      "client": "codex",
      "provider": "codex",
      "status": "ok",
      "source": "codex-cli",
      "plan": "plus",
      "account": null,
      "windows": [
        {
          "kind": "primary",
          "usedPercent": 39,
          "remainingPercent": 61,
          "windowMinutes": 10080,
          "resetsAt": "2026-08-07T09:00:00.000Z"
        }
      ],
      "credits": null,
      "subscriptionRenewsAt": "2026-09-03T10:00:00.000Z",
      "subscriptionExpiresAt": null,
      "message": null
    }
  ]
}
```

Every field below is present. Arrays are never null. Normalized timestamps
are ISO 8601 UTC strings. Missing optional upstream values generally become null.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | string, exactly `"1"` | Envelope version. |
| `generatedAt` | timestamp string | Captured before backend discovery and fetching; not a provider measurement timestamp. |
| `results` | result array | One result per selected client, in selection order. |
| `results[].client` | string | Selected client name. |
| `provider` | string or null | Mapped provider; null only for `not-applicable`. |
| `status` | string enum | One of the four statuses below. |
| `source` | string or null | Upstream source or `codexbar` fallback for `ok` and `error`; null for `unavailable` and `not-applicable`. |
| `plan` | string or null | Plan or login-method metadata; null when absent or status is not `ok`. |
| `account` | string or null | Account, email, or organization metadata; null when absent or status is not `ok`. |
| `windows` | window array | Normalized quota windows; empty when absent or status is not `ok`. |
| `credits` | credits object or null | Balance when reported; null when absent or status is not `ok`. |
| `subscriptionRenewsAt` | timestamp string or null | Subscription renewal date; null when absent or status is not `ok`. |
| `subscriptionExpiresAt` | timestamp string or null | Subscription expiry date; null when absent or status is not `ok`. |
| `message` | string or null | Null for `ok`; explanation for other statuses. Upstream errors can supply an empty string. |
| `windows[].kind` | string | Extensible identifier; consumers must accept unfamiliar kinds. |
| `windows[].usedPercent` | number or null | Used percentage clamped to 0–100; null when unknown. |
| `windows[].remainingPercent` | number or null | Remaining percentage clamped to 0–100; null when unknown. |
| `windows[].windowMinutes` | number or null | Finite duration value from upstream; no positivity or integer constraint. |
| `windows[].resetsAt` | timestamp string or null | Quota reset time, independent of subscription dates. |
| `credits.remaining` | number | Finite balance; not clamped, and may be negative or fractional. |
| `credits.unit` | string | Upstream unit, or `"credits"` when omitted or null. |

## Statuses and cardinality

- `ok`: an accepted payload was normalized. Even `{}` can produce `ok`
  with no windows, credits, or dates. Check the metrics you need.
- `unavailable`: no trusted backend was found, or the backend could not be
  started or its output pipes were unavailable.
- `not-applicable`: the client is provider-agnostic; no backend fetch occurs.
- `error`: provider failure, timeout, output overflow, malformed JSON, or
  invalid recognized data. Metrics are empty for the entire provider result.

Invalid recognized fields can invalidate a whole provider result. The
normalizer validates types of fields it reads, including some fallback fields
even when a higher-priority value exists. This is not a complete upstream
schema validator; unused fields may be ignored.

An upstream object is accepted when its provider is absent, null, or matches
the requested provider. An upstream array must be nonempty and contain only
objects. Its first matching provider record wins. A single unmatched object
is accepted only if its provider is absent or null. No match in a larger array
is an error. usagemux does not enumerate accounts or offer account selection.

## Normalization

### Windows

Collection order is:

1. Named `primary`, `secondary`, and `tertiary` windows. For each name,
   a non-null `usage` value takes precedence over the top-level value.
2. Arrays `windows`, `additionalWindows`, and `additional` in that order,
   first within `usage`, then at the top level. Each retains its array order.
3. `usage.extraRateWindows` in array order.

A window with `isSyntheticPlaceholder: true` is omitted. No deduplication
occurs. A window's own `kind` takes precedence; otherwise named windows use
their name, array windows use `<array-name>-<one-based-index>`, and extra
windows use `id`, then `title`, then `extra-<one-based-index>`.

For extra windows, `usageKnown: false` on the enclosing entry forces both
percentages to null, even if numbers are present. Otherwise explicit
`remainingPercent` wins; when it is missing or null, remaining is derived
as `100 - usedPercent` if used is known. Both percentages are clamped
independently to 0–100. They need not sum to 100 when both were supplied.
Invalid percentage types still fail validation even when usage is unknown.
`resetsAt` takes precedence over `resetAt`, including an explicit null.

### Credits, dates, and identity

Credits come from the top-level `credits` object. See the field table for
balance and unit semantics.

Subscription dates prefer non-null `usage` fields over top-level fields.
Without an explicit renewal date, the first extra window with `id: "renewal"`
supplies `window.resetsAt`, falling back to `window.resetAt` if null or absent.
Renewal entries are removed from quota windows. There is no equivalent
expiry fallback. Non-null explicit dates take precedence over the renewal
window. Input dates must be strings accepted by JavaScript's date parser;
output dates are normalized to UTC.

The first non-null string wins in these metadata lists (an empty string counts):

- Source: top-level `source`, `usage.source`, then literal `codexbar`.
- Plan: top-level `plan`, `usage.plan`, `usage.loginMethod`,
  `usage.identity.loginMethod`, `openaiDashboard.accountPlan`.
- Account: top-level `account`, top-level `accountEmail`,
  `usage.accountEmail`, `usage.identity.accountEmail`,
  `usage.accountOrganization`, `usage.identity.accountOrganization`,
  `openaiDashboard.signedInEmail`.

Thus `plan` is not necessarily a subscription tier, and `account` is not
necessarily an email address.

## Errors and escaping

Backend stdout is parsed before its exit code is interpreted. Valid non-null
JSON is normalized even after a nonzero backend exit. A structured upstream
`error` retains only its string value or its object's `message`; other error
metadata is discarded. Source is preserved when valid. Recognized validation
failures instead produce a diagnostic with source `codexbar`.

Malformed JSON produces a parsing diagnostic, taking precedence over stderr.
Without a non-null payload, a nonzero backend exit uses trimmed, truncated
stderr or the exit code, prefixed with `CodexBar failed for provider ...`.
A successful backend exit with empty or JSON-null stdout produces an empty-JSON
diagnostic. See [capture limits](BACKEND.md#execution-and-limits).

`withErrorRemedy(client, message, options = {})` appends advice only when:

- The message starts exactly with `No available fetch strategy for`.
  Structured provider errors normally use this route. A prefixed thrown
  failure does not match. Client-specific advice is in the
  [provider guide](PROVIDERS.md#credentials-and-remedies); others get an
  account-setup hint.
- The message starts with `CodexBar timed out after` and
  `options.ownTimeout === true`, set for usagemux's `BackendTimeoutError`.
  Advice accounts for `options.timeoutMs` and the CLI timeout cap.
  Backend-reported timeouts do not meet this condition.

All other messages remain unchanged. Remedies do not change result status.

Text uses the [CLI display escapes](CLI.md#output). JSON serialization escapes
C0 inside strings; the unreleased formatter also escapes DEL and C1 as
`\u00NN`. JSON parsing restores those characters, so consumers must escape
decoded strings before displaying them in terminals. Releases through v0.2.0
leave DEL and C1 raw in JSON. This is control-character escaping, not removal
of all Unicode characters that may affect visual presentation.

## Consumer example

This Python standard-library example checks one specific measurement.
It handles launch failure, missing envelopes, total provider failure, and
`ok` with unknown quota. JSON remains the machine interface.

```python
import json
import subprocess

try:
    run = subprocess.run(
        ["usagemux", "snapshot", "--client", "codex", "--format", "json"],
        capture_output=True, text=True, check=False,
    )
except OSError as error:
    raise SystemExit(f"usagemux could not start: {error}")

if not run.stdout.strip():
    raise SystemExit(f"No snapshot; exit {run.returncode}")
try:
    snapshot = json.loads(run.stdout)
except ValueError:
    raise SystemExit("Invalid snapshot JSON")
if snapshot.get("schemaVersion") != "1":
    raise SystemExit("Unsupported schema")
if run.returncode not in (0, 69):
    raise SystemExit(f"Unexpected exit {run.returncode}")

for result in snapshot["results"]:
    if result["status"] != "ok":
        print(result["client"], result["status"], ascii(result["message"]))
        continue
    primary = next(
        (window for window in result["windows"] if window["kind"] == "primary"),
        None,
    )
    if primary is None or primary["remainingPercent"] is None:
        print(result["client"], "primary quota unknown")
        continue
    print(result["client"], primary["remainingPercent"])
```
