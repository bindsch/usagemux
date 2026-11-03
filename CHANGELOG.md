# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.1] - 2026-11-03

### Fixed

- A window that upstream marks `isSyntheticPlaceholder` is no longer dropped
  from the snapshot. It is kept with `placeholder: true`, both percentages
  null, and its normal kind and reset time, so a consumer can tell a window
  that exists at an unknown level (a codex 5-hour window CodexBar synthesized
  without a measurement) from a window the backend did not report. Text
  output renders it as `primary: unknown remaining` followed by the reset
  time when upstream reports one.
- On exit 69, each `unavailable` client's message is now also written to
  stderr, one line per client, so a caller that keeps only stderr sees why
  the snapshot is unavailable. Stdout is unchanged, and provider-agnostic
  clients still report only on stdout.

### Changed

- CI runs on ubuntu and macOS, pins `actions/checkout` and
  `oven-sh/setup-bun` by commit SHA, derives the Bun version from
  package.json's `packageManager` field instead of hardcoding it, and adds a
  15-minute job timeout plus concurrency cancellation.

## [1.0.0] - 2026-10-31

### Added

- A size rule for the source tree: no TypeScript file under `src/` or
  `scripts/` may exceed 500 lines. Enforced by `tests/file-size.test.ts` in
  `make check` and stated in the development guide.

### Fixed

- Kimi credential advice no longer tells users to run `kimi login`, which is
  not a Kimi Code CLI command. Both remedy texts now say to run `kimi` and
  sign in when prompted.
- Copilot credential advice no longer suggests exporting `COPILOT_API_TOKEN`;
  nothing in CodexBar reads that variable. The device-flow instruction stays.
- Gemini no-strategy errors now name the actual prerequisite: sign in with
  the Gemini CLI so its credential exists, which CodexBar's default Gemini
  source reads.
- A renewal entry (`id: "renewal"`) whose `window` is absent or not an object
  no longer fails the whole provider result; it is treated as absent.
- An extra rate window with an empty `id` or `title` string now falls
  through to the next fallback label instead of emitting an empty `kind`.
- Kimi: replace CodexBar's "credential is invalid or expired" with the actual
  reason when the Kimi Code CLI's 15-minute access token has aged out (a
  refresh token is present and `expires_at` is within CodexBar's 60-second
  margin or past it). kimi refreshes that token on its next run; CodexBar never
  does. Honors `KIMI_CODE_HOME`; reads only the expiry and the presence of a
  refresh token; does not claim the sign-in is valid.

### Changed

- `windowMinutes` is emitted as null when upstream reports a negative value
  (0.2.x passed negatives through) or a non-finite one (0.2.x failed the whole
  provider result). Positive and zero values are unchanged, and
  `schemaVersion` stays `"1"`.
- An empty-string window `kind` or credit `unit` is treated as absent, so the
  documented fallback labels apply instead of an empty identifier.
- `usedPercent` and `remainingPercent` are clamped, then rounded to two
  decimals at emit, so JSON and text carry identical values. Derived
  remaining is computed from the rounded used value.
- The renewal-window date fallback follows the same `resetsAt`/`resetAt`
  precedence as quota windows: an explicit null `resetsAt` no longer falls
  back to `resetAt`.
- After a timeout kill, cleanup waits at most 2 seconds for pipe readers,
  then cancels the output streams and releases the call with its error. A
  descendant that escaped the process group and holds a pipe can no longer
  delay a bare CLI run until it exits; a cleanup that settles sooner clears
  the timer, so the process does not stay alive for the cap. The
  no-overall-deadline behavior is otherwise unchanged.
- The child environment and the rebuilt child `PATH` are built once per
  snapshot and shared by every provider call, instead of once per provider
  call. Executable discovery already ran once per snapshot and is unchanged.
- `make check` now runs the test suite under coverage and enforces a floor
  of 80% function and line coverage on every measured file under `src/`.
  The check reads a fresh report only (the previous `coverage/lcov.info`
  and temporary files are removed first, the report must be newer than a
  run stamp touched before the tests), refuses a record that lacks any of
  its `LF:`, `LH:`, `FNF:`, or `FNH:` summary lines or whose counters are
  not non-negative integers with hits at most found, and refuses a report
  that carries two records for one file. A test refuses any fixture file
  an ignore rule matches, so a fixture a fresh clone cannot see fails here
  first; the lcov fixture lives under `tests/fixtures/lcov/`.

- `src/normalize.ts` is split along its seams into `normalize.ts`,
  `normalize-windows.ts`, `normalize-dates.ts`, and `normalize-readers.ts`.
  `normalizeCodexBarPayload` keeps its module path. The move itself changes
  no behavior; the 1.0.0 behavior changes above apply to the moved code.
- The `pi` not-applicable message now says pi usage is not read yet because
  CodexBar's `pi` provider is unverified, instead of calling `pi`
  provider-agnostic.
- The 500-line size rule counts lines the way a reader does, so a final
  line without a trailing newline still counts, and it includes `.tsx`
  files under `src/` and `scripts/`.

### Security

- The resolved executable is re-validated immediately before every spawn:
  regular file, ownership by the current user or root, no group or world
  write permission, and the executable bit. A backend swapped after
  discovery is now rejected at launch.
- The per-spawn trust re-check re-runs the full discovery validation:
  symlink re-resolution, regular file, ownership by the current user or
  root, no group or world write permission, executable bit, directory
  chain, and working-tree exclusion. The spawn uses the re-resolved real
  path, so an executable replaced by a symlink after discovery, for
  example one pointing into the caller's working tree, is refused instead
  of executed. The re-check runs after the child environment is resolved,
  on every spawn path.

### Documentation

- State the percent rounding, `windowMinutes` null, and empty-`kind`/`unit`
  rules, and the `resetsAt`/`resetAt` precedence, in the protocol guide;
  explain why numeric strings are rejected while the Kimi credential reader
  accepts string epochs.
- Document the per-spawn trust re-check, the once-per-snapshot resolution,
  and the 2-second cleanup cap in the backend guide.
- Correct the `pi` row: CodexBar lists a `pi` provider whose usage reporting
  is not yet verified, so `pi` stays unmapped this release.
- Refresh stale strings: DEL/C1 JSON escaping shipped in 0.2.1, the install
  verification output matches the checked-out tag, the `qwencloud` mapping is
  a confirmed upstream provider ID, and clone/update instructions point at
  the current tag.
- The development guide names the coverage-floor exemptions (`src/index.ts`
  runs as a subprocess launcher; `src/types.ts` is declarations plus one
  constant) exactly as the coverage check has them, and the protocol's
  `not-applicable` definition now covers both provider-agnostic clients and
  the unverified `pi` provider.

### Upgrade notes

- JSON consumers see at most two decimals on `usedPercent` and
  `remainingPercent`; values such as `16.434343…` now arrive as `16.43`.
- Negative `windowMinutes` values arrive as null instead of as numbers, and a
  non-finite value no longer fails the provider result. Consumers that treated
  negatives as sentinels must read null instead.
- Scripts that match remedy text must update: `kimi login` and
  `COPILOT_API_TOKEN` no longer appear in any remedy.

## [0.2.1] - 2026-10-13

### Fixed

- Escape DEL and C1 controls in JSON output, in addition to JSON's existing
  C0 escapes. Decoded values are unchanged. Add a CLI regression test covering
  all three control ranges and JSON round trips.
- Correct CLI help to show standalone help/version forms, mutually exclusive
  selection, defaults, timeout bounds and fractions, and option repetition.
  Parser behavior is unchanged.
- Correct source comments about JSON escaping, remove review-round labels
  from source comments and test names, and use American spelling.

### Documentation

- Rebuild the README and split installation, CLI, JSON protocol, provider
  setup, backend guarantees, and development into focused references.
  Document nullability, normalization, empty successful results, total provider
  failure, pre-snapshot errors, trust checks, and subprocess limits.
- Record a live Kimi check on an identified backend build, inspected tool
  versions, and missing historical compatibility evidence. Add source
  installation, verification, update, removal, and
  optional contributor-hook instructions.
- Archive the dated alignment observations; remove stale implementation
  narratives and the missing scratch-file dependency. Keep HOOKS.md focused
  on its unchanged executable declarations.
- Correct and mark the v0.1.1 JSON-safety statement. Shorten v0.2.0 entries,
  remove private task context, and add its omitted contributor-hook entry.
  Add release/comparison links and publication instructions.
- Add the GitHub repository URL to package metadata. Package name, version,
  description, license, and executable entry remain unchanged.

## [0.2.0] - 2026-10-10

### Added

- Kimi Code usage through CodexBar, reusing an existing CLI credential or
  an API key.
- Antigravity (`agy`) support through CodexBar.
- `openhands` as a provider-agnostic client.
- Credential-setup advice for recognized no-strategy errors and timeout advice
  when usagemux's own provider timer fires. See the exact
  [remedy conditions](docs/PROTOCOL.md#errors-and-escaping).
- Contributor integration with hookrun and code-review, including the tracked
  Claude shim and local pre-commit gate configuration.
  **Changelog correction:** this shipped integration was omitted originally.

### Changed

- Default snapshots omit `agy`; `--all` includes it.
- Error messages include remedies in the cases above. The v1 envelope,
  result fields, statuses, and exit codes are unchanged.

## [0.1.1] - 2026-08-13

### Fixed

- Provider-supplied text fields (`plan`, `account`, `message`, window
  `kind`, and credit `unit`) escape C0, DEL, and C1 controls before
  terminal display.
- **Changelog correction:** the original note incorrectly claimed JSON
  already escaped all these controls. JSON serialization escapes C0 but
  leaves DEL and C1 unchanged in v0.1.1 and v0.2.0. The additional JSON
  escaping is an Unreleased fix, not part of this release.

## [0.1.0] - 2026-08-13

### Added

- Initial release: provider-neutral subscription usage CLI with a versioned
  JSON protocol, consumed by codemux through its optional `usage` command.
- CodexBar backend with environment scrubbing, PATH trust-chain validation,
  bounded output capture, and process-group timeouts.
- Normalization of quota windows, credits, and subscription renewal/expiry
  across providers.

[Unreleased]: https://github.com/bindsch/usagemux/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/bindsch/usagemux/releases/tag/v1.0.1
[1.0.0]: https://github.com/bindsch/usagemux/releases/tag/v1.0.0
[0.2.1]: https://github.com/bindsch/usagemux/releases/tag/v0.2.1
[0.2.0]: https://github.com/bindsch/usagemux/releases/tag/v0.2.0
[0.1.1]: https://github.com/bindsch/usagemux/releases/tag/v0.1.1
[0.1.0]: https://github.com/bindsch/usagemux/releases/tag/v0.1.0
