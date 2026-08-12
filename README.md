# usagemux

`usagemux` exposes subscription usage from coding-agent clients through one
small, versioned command-line protocol. It is designed to be an optional
integration: callers remain fully functional when `usagemux` or its backend is
not installed.

The MVP uses [CodexBar](https://github.com/steipete/CodexBar) as its backend.
`usagemux` locates the `codexbar` executable on `PATH`, invokes it directly
without a shell, and normalizes its JSON output. Credentials are never passed
in command-line arguments. Results include quota percentages and resets,
credits, provider source, plan/account metadata, and subscription renewal or
expiry timestamps when the provider reports them.

## Requirements

- Bun 1.3 or newer
- CodexBar CLI for applicable clients

The source launcher supports macOS and Linux. It accepts Bun from Homebrew's
standard prefixes or `$HOME/.bun/bin/bun`; this fixed lookup prevents a project
directory from substituting a hostile interpreter through `PATH`.

## Install

```sh
bun install
make link
```

Use `make link` rather than bare `bun link`: Bun currently broadens the source
launcher's mode while registering a package, and the target must be restored to
`0755` for Codemux's executable trust check.

CodexBar remains optional. Provider-agnostic clients can be identified without
it, and downstream tools can treat exit code 69 as an unavailable optional
integration.

## Usage

```sh
usagemux snapshot
usagemux snapshot --client codex --client claude
usagemux snapshot --all --format json --timeout 15
```

Supported clients are `aider`, `claude`, `cline`, `codex`, `copilot`, `cursor`,
`droid`, `goose`, `gemini`, `opencode`, `pi`, `qwen`, and `zai`.

`aider`, `goose`, and `pi` are provider-agnostic. Their results use the
`not-applicable` status because the subscription belongs to their configured
provider, not the client itself.

The default is all clients in concise text format. Use `--format json` for the
stable v1 envelope documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Development

```sh
make check
make coverage
```

The project has no runtime package dependencies. TypeScript and Bun types are
development-only dependencies.

The launcher selects and validates Bun from standard install locations instead
of trusting the caller's `PATH`. The CodexBar backend rejects executables inside
the caller's working tree, filters executable search paths and code-loader
environment variables, and terminates the full provider process group on
timeout or output overflow.

## License

MIT
