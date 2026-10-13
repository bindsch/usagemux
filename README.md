# usagemux

`usagemux` reads subscription usage through CodexBar and returns a versioned
JSON snapshot or concise text. Results can include quota windows, credits,
account metadata, and subscription dates. Missing measurements stay unknown.

## Requirements and installation

The source launcher supports macOS and Linux and requires Bun 1.3 or newer.
Development and CI use Bun 1.3.14. Applicable clients require the separate
[CodexBar CLI](https://github.com/steipete/CodexBar/blob/main/docs/cli.md).
Installing the macOS app alone does not expose its CLI on `PATH`.

After installing Bun and the CodexBar CLI:

```sh
git clone https://github.com/bindsch/usagemux.git
cd usagemux
git checkout v0.2.0
make install
make link
usagemux --version
usagemux snapshot --client aider
```

Keep this checkout: the linked launcher reads its source files at runtime.
See [installation](docs/INSTALLATION.md) for setup, compatibility evidence,
updates, removal, and launcher troubleshooting.

## First snapshot

```sh
usagemux snapshot
usagemux snapshot --client codex --client claude --format json
usagemux snapshot --all --timeout 90
```

The default selects every supported client except `agy`. `--all` changes
selection only; the last example also increases the per-provider timeout.

The [provider guide](docs/PROVIDERS.md) lists all client mappings, credential
setup, and limitations. Provider-agnostic clients need no backend and return
`not-applicable`. An `ok` result can have no usable quota measurement.
Provider errors can accompany exit code zero; integrations must inspect
[statuses and metric availability](docs/PROTOCOL.md).

## Documentation

- [Installation](docs/INSTALLATION.md): prerequisites, linking, updates, removal.
- [CLI reference](docs/CLI.md): syntax, defaults, text output, exit codes.
- [JSON protocol](docs/PROTOCOL.md): schema, normalization, consumer example.
- [Providers](docs/PROVIDERS.md): mappings, credentials, known limitations.
- [Backend reference](docs/BACKEND.md): discovery, trust rules, resource limits.
- [Development](docs/DEVELOPMENT.md): checks and optional contributor hooks.
- [Changelog](CHANGELOG.md): release history and unreleased changes.

## License

[MIT](LICENSE). CodexBar is a separate upstream dependency and is not bundled.
The repository has no runtime package dependencies or vendored third-party
implementation. Development dependencies retain their own licenses.
