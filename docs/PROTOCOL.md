# usagemux protocol v1

## Command

```text
usagemux snapshot [--client <client> ...] [--all]
                  [--format json|text] [--timeout <seconds>]
```

With neither `--client` nor `--all`, all clients are selected. `--client` is
repeatable. Combining it with `--all` is a usage error. The timeout applies to
each provider call and defaults to 10 seconds.

## JSON envelope

JSON mode writes one object to standard output:

```json
{
  "schemaVersion": "1",
  "generatedAt": "2026-08-03T10:00:00.000Z",
  "results": [
    {
      "client": "codex",
      "provider": "codex",
      "status": "ok",
      "source": "codexbar",
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

Every listed field is always present. Nullable fields use JSON `null`; arrays
are never nullable. Timestamps are ISO 8601 UTC strings.

`status` is one of:

- `ok`: usage was fetched and normalized.
- `unavailable`: the optional backend is absent or cannot be started.
- `not-applicable`: the client is provider-agnostic.
- `error`: the backend ran, but this provider failed or returned invalid data.

When CodexBar reports only `usedPercent`, `remainingPercent` is derived as
`100 - usedPercent`. Normalized remaining percentages are clamped to 0–100.

Credits, when present, have this exact shape:

```json
{ "remaining": 17.5, "unit": "USD" }
```

`subscriptionRenewsAt` and `subscriptionExpiresAt` preserve provider-reported
subscription dates when CodexBar exposes them. They are independent of quota
window reset times and are otherwise `null`.

`source` preserves CodexBar's selected provider source, such as `codex-cli`,
`openai-web`, or `oauth`; it falls back to `codexbar` when upstream omits it.

## Provider mapping

| Client | CodexBar provider |
| --- | --- |
| claude | claude |
| cline | clinepass |
| codex | codex |
| copilot | copilot |
| cursor | cursor |
| droid | factory |
| gemini | gemini |
| opencode | opencode |
| qwen | qwencloud |
| zai | zai |

`aider`, `goose`, and `pi` have no provider mapping.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The request is represented, including partial errors and not-applicable results. |
| 1 | An unexpected internal error occurred. |
| 64 | Invalid command-line usage. |
| 69 | Every requested applicable client is unavailable because CodexBar is absent or unusable. |

Consumers should parse statuses rather than treating a partial provider error
as process failure.

## Backend safety

The executable is resolved from absolute `PATH` entries, rejected when it is
inside the caller's working tree, and checked for regular-file, ownership,
write-permission, and trusted-directory invariants. It is invoked from its own
directory with a filtered `PATH` and code-loader environment using this argv:

```text
codexbar --provider <provider> --format json --json-only
```

No shell is involved. Runtime, process-tree lifetime, standard output, standard
error, and surfaced error detail are bounded. No credentials are passed in
argv. Provider credential variables remain available in the child environment;
known interpreter and dynamic-loader injection variables are removed.
