---
read_when:
  - Calling usagemux from a shell or checking parser behavior.
---

# CLI reference

## Syntax

```text
usagemux snapshot [--client <client> ... | --all]
                  [--format json|text] [--timeout <seconds>]
usagemux --help
usagemux -h
usagemux snapshot --help
usagemux snapshot -h
usagemux --version
usagemux -v
```

Help and version accept only these standalone forms. For example,
`snapshot --client codex --help` and `snapshot --version` are usage errors.
No command, an unknown command, an unknown client, or an unknown option is
also a usage error.

## Selection and options

| Option | Meaning |
| --- | --- |
| `--client <client>` | Select one client; repeat for more. Mutually exclusive with `--all`. |
| `--all` | Select every client in the [provider table](PROVIDERS.md#client-mapping). |
| `--format text\|json` | Select output; default `text`. |
| `--timeout <seconds>` | Per-provider timeout; default 10, greater than 0 and at most 300. Fractional seconds are accepted. |

With neither selection option, every client except `agy` is selected.
Explicit clients are deduplicated in first-occurrence order. Default and
`--all` results follow the provider table's order.

Value options accept either `--option value` or `--option=value`.
Repeated format and timeout options use the last value, but every occurrence
must be valid. Repeating `--all` has no further effect.
Options can appear in any order after `snapshot`.

```sh
usagemux snapshot --client=codex --client claude --format=json --timeout=2.5
usagemux snapshot --client agy --timeout 90
usagemux snapshot --all --timeout 90
```

`--all` does not increase the timeout. The timer applies to each provider,
not the whole command; see [execution limits](BACKEND.md#execution-and-limits).

## Output

Provider calls run concurrently. A single output is emitted after collection
finishes; output is not streamed as each provider finishes.
Use [JSON](PROTOCOL.md) for machine consumers. Text is a display format.

Example text:

```text
codex: ok (plus, user@example.com)
  primary: 60% remaining; resets 2026-08-04T10:00:00.000Z
  credits: 17.5 USD remaining
  subscription renews: 2026-09-03T10:00:00.000Z
```

Each result starts with client and status. Non-null plan and account follow
in parentheses. A non-`ok` result then shows its message, if nonempty.
An `ok` result shows each window's kind, remaining percentage, and reset,
then credits and subscription renewal/expiry dates when present.

Numbers are rounded to at most two decimal places; trailing zeros are omitted.
Unknown window values appear as `unknown remaining` and `reset unknown`.
An `ok` result with no windows, credits, or subscription dates shows
`No usage windows reported.`

Text omits schema version, generation time, provider, source, used percentage,
and window duration. Provider-controlled display strings escape C0
(U+0000–U+001F), DEL (U+007F), and C1 (U+0080–U+009F) as literal `\xNN`
sequences. See the protocol for JSON escaping.

## Exit behavior

| Code | Meaning |
| --- | --- |
| 0 | Help/version succeeded, or snapshot collection completed and the condition for 69 below did not apply. Every applicable provider can return `error` and still yield zero. A selection of only provider-agnostic clients also yields zero. |
| 1 | An unexpected internal error was caught by the CLI; it writes a plain-text diagnostic to stderr. |
| 64 | Invalid command-line usage; stdout is empty and stderr is plain text, even when `--format json` was requested. |
| 69 | A completed snapshot has at least one applicable client and all applicable clients are `unavailable`. The requested output is still emitted. The launcher also uses 69 when no trusted Bun is found; that failure has plain-text stderr and no JSON envelope. |

Launcher or runtime failures before the CLI starts can have other exit codes
and no envelope. The JSON guarantee applies only to completed snapshot
collection. Consumers must handle empty stdout and parse result statuses;
see the [consumer example](PROTOCOL.md#consumer-example).
