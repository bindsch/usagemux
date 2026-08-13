# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
