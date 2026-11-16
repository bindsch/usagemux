---
read_when:
  - Selecting clients, configuring credentials, or interpreting missing quota.
---

# Providers

usagemux delegates fetching and authentication to CodexBar. It does not log
in, refresh credentials itself, or provide native provider fetchers.
It never reads the macOS Keychain or runs `security`.
[Compatibility evidence](INSTALLATION.md#compatibility-evidence) identifies
the inspected backend and the limits of the historical live tests.
The upstream [provider documentation](https://github.com/steipete/CodexBar/blob/main/docs/providers.md)
describes current setup; details may differ by backend version.

## Client mapping

This is the complete mapping and the order used by `--all`.
Default selection is identical to `--all`, including `agy`.

| Client | CodexBar provider |
| --- | --- |
| agy | antigravity |
| aider | None; provider-agnostic |
| claude | claude |
| cline | clinepass |
| codex | codex |
| copilot | copilot |
| cursor | cursor |
| droid | factory |
| goose | None; provider-agnostic |
| gemini | gemini |
| kimi | kimi |
| opencode | opencode |
| openhands | None; provider-agnostic |
| pi | None; not mapped yet (see note) |
| qwen | qwencloud |
| zai | zai |

Provider-agnostic clients return `not-applicable` because usage belongs to
their configured provider. usagemux does not inspect their model routing.
Select a mapped client for the provider you want to inspect.

`pi` is different: CodexBar lists a `pi` provider, so the client is not
provider-agnostic in principle. That provider's usage reporting is not yet
verified, so this release keeps `pi` unmapped and returns `not-applicable`
for it instead of mapping a provider whose output has not been confirmed.

## Credentials and remedies

CodexBar's ability to read credentials does not establish whether a harness
is signed in. Configure CodexBar's credential source for usage readings.
The shipped credential advice is:

| Client | Setup |
| --- | --- |
| kimi | CodexBar found no Kimi credential it can read. Kimi 2.6 stores its login in `credentials/kimi-code-env-<id>.json`. Export `KIMI_CODE_API_KEY` for the codexbar process to read usage meanwhile. |
| copilot | CodexBar could not read Copilot usage with its available credentials. Add a Copilot account in CodexBar using its GitHub device flow. A plain `gh auth token` is unsuitable for the Copilot usage API. |
| cline | CodexBar could not read Cline usage with its available credentials. Add a ClinePass API key in CodexBar under Settings > Providers > ClinePass. |
| gemini | CodexBar could not read Gemini usage with its available credentials. Configure a Gemini account or credential source in CodexBar. |
| Other mapped clients | CodexBar could not read usage with its available credentials. Configure an account or credential source for the provider in CodexBar. |

Credential advice is appended only under the
[protocol's exact remedy conditions](PROTOCOL.md#errors-and-escaping).
Missing credentials for one installation do not mean that provider is
unsupported everywhere. No remedy tells the user to sign in to a harness
based on CodexBar's diagnostic. Every CodexBar diagnostic is preserved with a
`CodexBar reported: ` prefix and ends with the fixed sentence:
"This is CodexBar's own diagnostic and says nothing about whether the harness is signed in."
The sentence follows any provider advice, regardless of diagnostic wording.
Only structured error text and failed-process stderr are attributed
to CodexBar. usagemux's own diagnostics have no attribution prefix or closing sentence.
No backend diagnostic or no-strategy suffix is discarded.

For Kimi's aged-out token diagnostic, usagemux checks every matching regular
`kimi-code*.json` file in the credentials directory, in sorted order. This
includes legacy and Kimi 2.6 environment files. A refresh-bearing token must
be within 60 seconds of expiry or older, and no file may have a fresh expiry.
Every matching regular file must have a readable `expires_at`; an absent or
invalid expiry makes the scan inconclusive, even beside an expired legacy file.
The check is bounded and scans the canonical directory, accepting directory
symlinks while opening files without following symlinks. A matching entry
that is a symlink or not a regular file makes the scan inconclusive; see
[credential scan limits](PROTOCOL.md#errors-and-escaping).
The aged-out explanation is appended to the attributed backend diagnostic.
If CodexBar reports `credential is invalid or expired` but the scan is
inconclusive or finds a fresh token, the `KIMI_CODE_API_KEY` hint is appended
instead. Copilot's no-strategy remedy retains its GitHub device-flow advice.
CodexBar does not refresh CLI-owned credentials. An expired access token
does not prove that the harness's login is invalid.

## Placeholder windows

CodexBar marks some windows `isSyntheticPlaceholder` when it synthesizes a
window without a measurement, such as a 5-hour session window it infers from
a plan. usagemux keeps such a window instead of dropping it: it carries
`placeholder: true` with null percentages and its normal kind. A consumer can
therefore tell a window that exists at an unknown level from a window the
backend did not report. Text output renders it as
`primary: unknown remaining; reset unknown`. See
[window semantics](PROTOCOL.md#normalization).

## Antigravity

The 2026-10-10 run observed a local language-server probe followed by an
offline fallback using local conversation information. With the IDE closed,
the probe exceeded the then-default 10-second timeout; a 90-second request completed.
Version 1.1.0 uses 90 seconds for `agy` by default:

```sh
usagemux snapshot --client agy
# To select every client with the same longer wait:
usagemux snapshot --all --timeout 90
```

That run returned `ok`, plan `offline`, and an
`antigravity-offline-conversations` window with unknown remaining quota and
reset. It did not establish available Google quota. The duration and fallback
are observations of that installation, not promises about other builds.

Consumers must inspect metric availability as well as status. In particular,
unknown is not zero, unlimited, or evidence of unused quota.
See [window semantics](PROTOCOL.md#normalization).

## Scope and limitations

Each selected client yields one result. usagemux has no account-selection or
multi-account enumeration options. CodexBar chooses the source and account;
only the first matching provider record is normalized.

Measurements depend on upstream availability, credentials, permissions, and
backend version. Linux may offer different sources from macOS. Use
`message` and the upstream provider guide to diagnose failures, and do not
infer a usable measurement from exit zero or `ok` alone.
