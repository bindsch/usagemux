---
read_when:
  - Selecting clients, configuring credentials, or interpreting missing quota.
---

# Providers

usagemux delegates fetching and authentication to CodexBar. It does not log
in, refresh credentials itself, or provide native provider fetchers.
[Compatibility evidence](INSTALLATION.md#compatibility-evidence) identifies
the inspected backend and the limits of the historical live tests.
The upstream [provider documentation](https://github.com/steipete/CodexBar/blob/main/docs/providers.md)
describes current setup; details may differ by backend version.

## Client mapping

This is the complete mapping and the order used by `--all`.
Default selection uses the same order with `agy` omitted.

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

Configure authentication in CodexBar or its supported provider CLI.
The shipped credential advice is:

| Client | Setup |
| --- | --- |
| kimi | Run `kimi` and sign in when prompted to establish or renew the CLI credential at `~/.kimi-code/credentials/kimi-code.json` (or under `KIMI_CODE_HOME`), or export `KIMI_CODE_API_KEY` for the backend process. On the CLI-credential route, the access token lives 15 minutes and only the CLI refreshes it, so CodexBar reads Kimi usage only within about 15 minutes of a kimi run. When it reports "invalid or expired" while the credential holds a refresh token, usagemux replaces the message with that reason (see [error remedies](PROTOCOL.md)); an exported `KIMI_CODE_API_KEY` avoids the limit. CodexBar does not refresh CLI-owned credentials. See the [Kimi authentication reference](https://github.com/steipete/CodexBar/blob/main/docs/kimi.md). |
| copilot | Add a Copilot account in CodexBar using its GitHub device flow. The shipped remedy identifies a plain `gh auth token` as unsuitable for the Copilot usage API. |
| cline | Install the Cline CLI and run `cline auth`, or add a ClinePass API key in CodexBar under Settings > Providers > ClinePass. |
| gemini | Run `gemini` and complete its sign-in so the Gemini CLI credential exists; CodexBar's default Gemini source reads that credential. Adding an account for the provider in CodexBar is the alternative. |
| Other mapped clients | Add the provider account in CodexBar and follow its authentication diagnostic and provider guide. |

Credential advice is appended only under the
[protocol's exact remedy conditions](PROTOCOL.md#errors-and-escaping).
Missing credentials for one installation do not mean that provider is
unsupported everywhere. Unknown errors are not rewritten into login advice.

## Antigravity

The 2026-10-10 run observed a local language-server probe followed by an
offline fallback using local conversation information. With the IDE closed,
the probe exceeded the default timeout; a 90-second request completed:

```sh
usagemux snapshot --client agy --timeout 90
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
