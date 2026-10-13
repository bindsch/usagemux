---
read_when:
  - Installing, updating, or troubleshooting the source launcher.
---

# Installation

## Obtain the source

[GitHub releases](https://github.com/bindsch/usagemux/releases) provide source
archives. Releases through v0.2.0 have no attached binary assets. Either unpack
a source archive and enter its directory, or clone a tagged release:

```sh
git clone https://github.com/bindsch/usagemux.git
cd usagemux
git checkout v0.2.0
```

## Install prerequisites

Install Bun using its [installation guide](https://bun.sh/docs/installation).
The package requires Bun 1.3 or newer; CI and the package-manager declaration
use 1.3.14. The launcher accepts only the locations listed under troubleshooting.

Install CodexBar separately using the
[upstream CLI guide](https://github.com/steipete/CodexBar/blob/main/docs/cli.md).
On macOS, the app's Preferences > Advanced > Install CLI action exposes its
bundled helper as `codexbar` in standard binary directories. Installing the
app alone is insufficient. For a standalone macOS or Linux release, follow
that guide and place the executable in a trusted directory on `PATH`.

Verify the executable and version without fetching account data:

```sh
bun --version
command -v codexbar
codexbar --version
```

CodexBar is optional for provider-agnostic clients. Its absence is represented
by the [CLI exit behavior](CLI.md#exit-behavior) for applicable clients.

## Compatibility evidence

On 2026-10-13, interface checks of the installed macOS arm64 helper reported
CodexBar 0.72.0, app build 164, on Darwin 27.0.0. The helper was
`/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`, with SHA-256:

```text
3133dd8c790a4fcd2eb5db578932382d175c06770884d49bf9767ef627596da6
```

The checks used `--version` and `--help`, followed by
`./bin/usagemux snapshot --client kimi --format json`. Discovery selected
the helper identified above. That live request exited zero and returned
schema v1, status `ok`, and two windows with known remaining percentages.
Account details and quota values are not reproduced here.

This establishes one successful Kimi fetch on this build and installation,
not a certified minimum backend version or compatibility for every provider.
Its help lists `qwen-cloud`, while the released usagemux mapping uses
`qwencloud`; alias compatibility was not established.

The [2026-10-10 report](archive/align-0.2-report.md) records live Kimi and
Antigravity observations but did not capture a backend version or digest.
That missing evidence cannot be reconstructed from today's installation.
Automated usagemux tests use fixtures, not live provider accounts. Confirm
compatibility for the clients you use after each backend update:

```sh
usagemux snapshot --client codex --format json
```

Inspect both status and measurements using the [protocol guide](PROTOCOL.md).
Provider behavior and credentials depend on the backend build and platform.

## Install and verify

From the source directory:

```sh
make install
make link
usagemux --version
usagemux --help
usagemux snapshot --client aider
```

`make install` uses the frozen Bun lockfile. `make link` registers the package
and restores `bin/usagemux` to mode 0755 after Bun changes its permissions.
Use the Makefile target rather than bare `bun link`. Ensure Bun's global
binary directory, normally `~/.bun/bin`, is on `PATH`.

At v0.2.0, the version output is `usagemux 0.2.0`. The final command should
exit zero and report `aider: not-applicable` without consulting CodexBar.

The link points into this checkout. Keep `bin/`, `src/`, `package.json`,
and `bunfig.runtime.toml` in place. This is not a standalone binary install.

## Update or remove

To update, fetch tags in the retained checkout, check out the chosen release,
and rerun `make install`, `make check`, and `make link`. For example,
`git fetch --tags` followed by `git checkout v0.2.0` selects that release.
Resolve local changes before changing versions.

Run `make unlink` from the retained checkout to remove the global package
link. You may then remove the source directory. This does not uninstall Bun,
CodexBar, or provider credentials.

## Launcher troubleshooting

`Bun was not found in a trusted install location.` means no candidate passed
the launcher's checks. Lookup order is:

1. `/opt/homebrew/bin/bun`
2. `/usr/local/bin/bun`
3. `/home/linuxbrew/.linuxbrew/bin/bun`
4. `~/.bun/bin/bun`

The launcher does not search `PATH` for Bun. Both the candidate and its
resolved target must be outside the current directory and its descendants.
A regular executable must resolve within 32 symlink hops, be owned by the
current user or root, and have no group or world write bits. Rejected
candidates are skipped. It does not apply the backend's ancestor-directory
ownership checks to Bun.

A Bun install beneath the current directory can therefore be rejected even
though `bun --version` works. Run usagemux from a narrower directory outside
the interpreter installation, or install Bun at an accepted location.
Check ownership, executable permissions, and symlink targets if it still fails.

For `CodexBar was not found on PATH.`, see the separate
[backend discovery rules](BACKEND.md#discovery-and-trust).
