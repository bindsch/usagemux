# usagemux 0.2.0 alignment report

Date: 2026-10-10. Branch `align-0.2`, forked from `main` at 0.1.1. This report
covers the usagemux half of gaps 1, 2, and 5 in `scratch/support-matrix-audit.md`.

## Bottom line

usagemux 0.2.0 sees every harness the operator routes to. `kimi` and `agy` are
new clients, both mapped to CodexBar providers that already existed on this
machine; `openhands` is `not-applicable` like aider, goose, and pi; every
credential-less or timed-out `error` now names an operator remedy, including CodexBar's structured JSON
errors, which previously bypassed the remedy path. The protocol envelope is
unchanged and codemux was not touched. All three sanctioned live proof runs
were executed through `./bin/usagemux` and are quoted below.

## What was built

### 1. kimi client (audit gap 1)

Mapped, not implemented natively. The task's decision tree said to map the
client if CodexBar has a provider, and it does:

- The CodexBar CLI binary (`/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`)
  contains the standalone provider id `kimi` in its provider table, next to
  `codex`, `clinepass`, `antigravity`, `copilot`, `moonshot`, and the rest.
- The same binary names the endpoints the provider calls:
  `apiv2/kimi.gateway.billing.v1.BillingService/GetUsages` and
  `kimi.gateway.membership.v2.MembershipService/GetSubscription` (+`Stats`).
- Its embedded error strings show the credential source: the Kimi Code CLI's
  own login, with `KIMI_CODE_API_KEY` as the API-key alternative and the
  explicit note that CodexBar does not refresh CLI-owned credentials.
- `CLIENT_PROVIDERS.kimi = "kimi"` in `src/clients.ts`; the normalizer needed
  no changes because CodexBar emits its standard usage JSON for this provider.

A native strategy was therefore unnecessary, and the `kimi` CLI offers no
quota command anyway: `kimi --help` lists `export`, `provider`, `acp`, `web`,
`login`, `doctor` only.

File-shape verification (values never read or printed):
`~/.kimi-code/credentials/kimi-code.json` holds an OAuth2 token object with
exactly `access_token`, `refresh_token`, `expires_at`, `scope` (`kimi-c…`),
`token_type` (`Bearer`), `expires_in`. This is the file CodexBar's kimi
provider reads; it was refreshed by the CLI the same evening.

### 2. openhands client

`CLIENT_PROVIDERS.openhands = null` → `not-applicable` with the standard
provider-agnostic message, matching the task's instruction and the audit's
classification alongside aider, goose, and pi.

### 3. agy client (audit gap 2, usagemux half)

Mapped to CodexBar's `antigravity` provider:

- Provider id `antigravity` is in the same binary provider table.
- CodexBar's embedded strings describe the strategy: a local Antigravity
  language-server probe, an `agy` CLI HTTPS source, a Google OAuth fallback,
  and `AntigravityLocalReader` reading local token history. The `agy` binary
  itself contains quota-related telemetry protobufs but no CLI quota command
  (`agy --help` subcommands: agent, changelog, install, mcp, models, plugin,
  remote-control, update).
- `CLIENT_PROVIDERS.agy = "antigravity"`.

One operational fact surfaced by the live runs: the probe outlasts the 10
second default timeout when the IDE is closed. The timeout error now carries
a remedy saying so, and the README documents `--timeout 90`. The scode half
of audit gap 2 (knowing `agy` in `KNOWN_HARNESSES`) is out of scope here.

### 4. copilot and cline (audit gap 5)

Both stay on their existing CodexBar mappings with honest, actionable errors:

- copilot: CodexBar has a `copilot` provider (`CopilotDeviceFlow` plus
  `/copilot_internal/user`, `COPILOT_API_TOKEN` as the env override, all
  visible in the binary). On this machine no credential is configured, so it
  reports "No available fetch strategy for copilot." A native `gh auth token`
  strategy was considered and rejected: the Copilot usage API requires a
  Copilot-integration token obtained through the GitHub device flow (which is
  exactly why CodexBar implements its own), a plain gh token is not accepted,
  and this sandbox could not read `~/.config/gh` or the Copilot CLI's
  extracted package to verify any alternative. Per the honesty rule the
  client keeps `error`, now with a message naming the missing strategy and
  the two ways to fix it. `COPILOT_API_TOKEN` genuinely reaches codexbar:
  `buildBackendEnvironment` filters only interpreter and loader variables
  and rebuilds `PATH` (verified in `src/backend.ts`).
- cline: cline is a VS Code extension with no CLI on this machine; CodexBar's
  `clinepass` provider has no credential source as a result. Its error now
  says to run `cline auth` or add a ClinePass API key in CodexBar under
  Settings > Providers > ClinePass (wording follows CodexBar's own embedded
  strings).

### 5. Diagnostics

`src/clients.ts` gained `withErrorRemedy(client, message)`. It appends a
remedy when the upstream message is CodexBar's credential-less
"No available fetch strategy for …" or its timeout message, using a per-client
table (copilot, cline, agy) with generic fallbacks. `src/snapshot.ts` applies
it on both error routes. The second route mattered: the first live copilot
proof run showed the remedy missing because CodexBar exits non-zero but still
emits structured JSON, which `runCodexBar` returns as a payload; that message
flowed through the normalizer and skipped the throw-path remedy. Fixed by
applying the remedy to normalized `error` results as well, with a regression
test reproducing the structured payload shape from
`tests/fixtures/structured-error/codexbar`.

The droid, gemini, opencode, and qwen errors already carried upstream remedies
and are untouched.

### 6. Version and docs

- `package.json` 0.2.0.
- `CHANGELOG.md` gained `## [0.2.0] - 2026-10-10`.
- README: client list, provider-agnostic set, kimi/agy credential and timeout
  notes.
- `docs/PROTOCOL.md`: two provider-table rows (agy, kimi), the default
  selection paragraph, and the remedy paragraph. The envelope, result fields, statuses, and exit codes are
  unchanged; protocol version stays "1" and codemux was not touched.
- Tests: client set and mapping assertions updated (13 → 16 clients), plus
  new tests for openhands, both remedy routes, the timeout remedy, and the
  kimi provider mapping. No network in tests; all new tests use fakes.

## Live proofs

All three sanctioned runs, through `./bin/usagemux`, quoted verbatim. The
kimi numbers were percentages already; no other quota figures appear.

```text
$ ./bin/usagemux snapshot --client kimi            # exit 0
kimi: ok
  primary: 81% remaining; resets 2026-10-16T17:27:55.000Z
  secondary: 5% remaining; resets 2026-10-10T00:27:55.000Z

$ ./bin/usagemux snapshot --client agy --timeout 90   # exit 0 (10s default times out)
agy: ok (offline)
  antigravity-offline-conversations: unknown remaining; reset unknown

$ ./bin/usagemux snapshot --client copilot          # exit 0
copilot: error
  No available fetch strategy for copilot. Add a Copilot account in CodexBar (menu > Add / switch account, GitHub device flow) or export COPILOT_API_TOKEN for the codexbar process; a plain gh auth token cannot authenticate to the Copilot usage API.
```

Two observations from the live runs:

- kimi's access token expired between the proof run above and the later full
  snapshot; the later run reports CodexBar's own remedy ("Run kimi to renew
  it, or add a Kimi Code API key…"). That message already meets the
  actionable-error standard, so no usagemux remedy was added for it. The
  operator action is `kimi login`.
- A full 16-client snapshot under this session's sandboxed shell shows claude
  failing to prepare its isolated probe directory. The 2026-10-09 audit had
  claude green on this machine, and 0.2.0 does not touch the claude path;
  the failure is an artifact of running inside the sandbox, not a regression.

## Gates

```text
$ make check
bun run typecheck        # exit 0
bun test                 # 56 pass, 0 fail, 108 expect() calls, 6 files
sh -n bin/usagemux       # exit 0

$ python3 ~/.claude/skills/humanizer/scripts/check_american.py \
    README.md CHANGELOG.md docs/PROTOCOL.md src/clients.ts src/snapshot.ts docs/align-0.2-report.md
Scanned 6 files. 0 British spelling(s) found.   # exit 0
```

Test count moved from 43 to 56 (13 new: nine in `tests/clients.test.ts`
(copilot, cline, generic fallback, agy timeout, untouched messages, the
cap-aware timeout, the kimi remedy, the structured timeout without remedy,
and the default client set) and four in `tests/snapshot.test.ts` (the
no-strategy remedy on a bare message, the structured-error route, the timeout
remedy, and the kimi mapping)); the CLI default-selection test was rewritten
in place.

## What remains unsupported, and why

- copilot native fetch: blocked on credential semantics, not code. The
  Copilot usage API takes a Copilot-integration token from the GitHub device
  flow; `gh auth token` is not one, and no documented usagemux-readable
  Copilot credential exists on this machine.
- cline: nothing to read until the extension (or its auth) is installed; the
  error says exactly that.
- droid, gemini, opencode, qwen: unchanged upstream conditions (Full Disk
  Access for Safari cookies, gemini login, browser session cookies); their
  upstream messages already state the remedy.
- agy percentages: CodexBar reports local conversation history with unknown
  remaining/reset values rather than a Google quota; the client reports that
  honestly instead of deriving a number.
- scode's `KNOWN_HARNESSES` still lacks `agy`, and the codemux session/ledger
  gaps in the audit are separate work.

## Round um2 (the second review's findings)

- major, default snapshot waited out agy's probe: `agy` left the default
  client set (`DEFAULT_CLIENTS` in `src/clients.ts`); `--all` and
  `--client agy` still read it. README and `--help` say so. Test: the CLI
  parser's default excludes agy and `--all` includes it.
- minor, kimi remedy: a kimi-specific credential remedy (`kimi login`,
  `KIMI_CODE_API_KEY`) matching the README. Test added.
- minor, cline remedy: "Install the Cline CLI and run cline auth" matches
  section 4. Test updated.
- minor, timeout remedy on CodexBar's own messages: the remedy is applied
  only when usagemux's `BackendTimeoutError` fired (`ownTimeout`), never to
  a timeout CodexBar reports inside its JSON. Test: a structured timeout
  message gets no remedy.
- minor, overstated claim: the bottom line now says "every credential-less
  or timed-out error".
- minor, mid-file import in `src/cli.ts`: moved into the import block,
  without the `.js` suffix the file does not use.
