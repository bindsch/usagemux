# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/bindsch/usagemux/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bindsch/usagemux/releases/tag/v0.2.0
[0.1.1]: https://github.com/bindsch/usagemux/releases/tag/v0.1.1
[0.1.0]: https://github.com/bindsch/usagemux/releases/tag/v0.1.0
