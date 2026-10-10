# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-10

### Added

- `kimi` client, mapped to CodexBar's `kimi` provider. CodexBar reads the Kimi
  Code CLI's own credential (`~/.kimi-code/credentials/kimi-code.json`), so
  quota for the routing note's Kimi leg no longer needs a separate login.
  Verified against CodexBar's provider table and its Kimi billing endpoints
  (`kimi.gateway.billing.v1.BillingService/GetUsages`,
  `kimi.gateway.membership.v2.MembershipService/GetSubscription`).
- `agy` client (Antigravity CLI), mapped to CodexBar's `antigravity` provider,
  which probes the local Antigravity language server and falls back to the
  `agy` CLI's Google OAuth credential. Gemini CLI remains mapped for accounts
  that still have it.
- `openhands` client as provider-agnostic (`not-applicable`), matching
  aider, goose, and pi: the subscription belongs to its configured provider.
- Actionable remedies appended to CodexBar's credential-less
  "No available fetch strategy" errors: for copilot (add a Copilot account in
  CodexBar via the GitHub device flow, or export `COPILOT_API_TOKEN`; a plain
  `gh auth token` cannot authenticate to the Copilot usage API), for cline
  (install the Cline CLI and run `cline auth`, or add a ClinePass API key in
  CodexBar), for kimi (run `kimi login`, or export `KIMI_CODE_API_KEY`), and
  a generic account-setup remedy for any other provider. Timeout errors gain one too:
  for agy, retry with a longer `--timeout` (the language-server probe
  outlasts the 10-second default with the IDE closed); other providers get a
  generic retry hint, and both say when the 300-second `--timeout` cap was
  already in use. The credential remedy applies to CodexBar's structured
  JSON error payload, the route a credential-less provider takes (a thrown
  backend error keeps its prefixed message); the timeout remedy applies only
  when usagemux's own per-call timeout fired.

### Changed

- The v1 envelope, result fields, statuses, and exit codes are unchanged.
  Two documented behaviors did change: the default client selection (a bare
  `usagemux snapshot` leaves `agy` out; `--all` includes it) and the text of
  `error` messages, which now carry an appended remedy in the two cases
  above.

## [0.1.1] - 2026-08-13

### Fixed

- Provider-supplied strings (`plan`, `account`, `message`, window `kind`, and
  credit `unit`) are escaped before reaching a terminal. A hostile or
  compromised upstream response could previously emit ANSI/OSC sequences to
  move the cursor, clear the screen, or drive terminal reporting. The JSON
  output was never affected: `JSON.stringify` already escapes these characters.

## [0.1.0] - 2026-08-13

### Added

- Initial release: provider-neutral subscription usage CLI with a versioned
  JSON protocol, consumed by codemux through its optional `usage` command.
- CodexBar backend with environment scrubbing, PATH trust-chain validation,
  bounded output capture, and process-group timeouts.
- Normalization of quota windows, credits, and subscription renewal/expiry
  across providers.
