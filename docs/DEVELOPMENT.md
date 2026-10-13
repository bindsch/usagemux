---
read_when:
  - Contributing, verifying changes, or preparing a release.
---

# Development

## Install and check

Use Bun 1.3.14, Git, Make, and a POSIX shell. From the checkout:

```sh
make install
make check
make coverage
```

`make install` uses `bun install --frozen-lockfile`.
The full gate, `make check`, runs TypeScript checking, the complete Bun test
suite, and `sh -n bin/usagemux`. The repository has no separate lint or
documentation-check target. `make coverage` is a separate coverage report.
Neither command requires a real CodexBar installation or provider login.

Tests use fake backends and local executable fixtures. They create and remove
temporary directories, change fixture permissions, and launch fixture
processes to test failure and termination behavior. The launcher test needs
Bun at an [accepted location](INSTALLATION.md#launcher-troubleshooting).
Tests do not call real agent harnesses or provider APIs.

For the operator's additional American English check:

```sh
python ~/.claude/skills/humanizer/scripts/check_american.py README.md CHANGELOG.md HOOKS.md docs/*.md docs/archive/*.md src/*.ts tests/*.ts
```

That private script is optional operator tooling, not shipped with this
repository or required by `make check`.

## Layout

| Path | Responsibility |
| --- | --- |
| `bin/usagemux`, `bunfig.runtime.toml` | Trusted Bun lookup and runtime configuration. |
| `src/cli.ts`, `src/index.ts` | Arguments, entry point, output, exit codes. |
| `src/clients.ts` | Client mapping, defaults, error remedies. |
| `src/backend.ts` | Discovery, environment, process execution, limits. |
| `src/normalize.ts`, `src/types.ts` | Upstream normalization and public data types. |
| `src/snapshot.ts` | Concurrent collection and provider statuses. |
| `src/format.ts` | Text and JSON formatting. |
| `tests/` | Unit tests and executable fixtures. |
| `docs/` | Current references; dated evidence in `docs/archive/`. |

Keep contracts in their relevant reference and link to them elsewhere.
Record every documentation, metadata, and behavior change under Unreleased in
the [changelog](../CHANGELOG.md). Do not silently change released guarantees.

## Optional review hooks

Runtime installation and `make check` do not need review tooling.
This repository tracks a Claude shim in `.claude/settings.json`.
[HOOKS.md](../HOOKS.md) contains the executable declarations. Local trust and
Git hook installation are separate.

The inspected tool interfaces on 2026-10-13 were `hookrun 0.1.0` and
`code-review 0.1.0`. Review execution was not tested as part of this rebuild.
The Python packages require Python 3.10+ and 3.11+, respectively; use 3.11+
for both. These are operator-provided tools; a public installation source for
this pair was not verified. Obtain compatible source checkouts from the
operator before enabling these hooks. The operator's checkout locations are
`~/Programming/Ops/hookrun` and `~/Programming/Ops/code-review`; consult each
checkout's `README.md` and `pyproject.toml` for its setup and dependencies.
With uv installed, install the Python packages from those checkouts:

```sh
uv tool install ~/Programming/Ops/hookrun
uv tool install ~/Programming/Ops/code-review
```

The installed code-review command must support
`run --profile default` and `gate`. Review execution also needs codemux,
configured reviewer harnesses, authentication, and provider quota.

Verify command availability and versions before approving the hook file:

```sh
command -v hookrun code-review codemux
hookrun --version
code-review --version
hookrun check
hookrun list
```

After reading the declarations, the operator can enable them:

```sh
hookrun trust --allow-shell
hookrun install claude git
```

Trust records approval of the configuration digest. Edits invalidate that
approval. Inspect installation output: an existing foreign pre-commit hook
can prevent installation even when the command exits successfully.

The task-end hook starts an asynchronous review. Earlier feedback reduces
the work that may block a later commit. The pre-commit gate reads the saved
verdict without a model call; it runs before the commit. A missing or stale
verdict can still delay the commit while review finishes.

Verdicts are local writable state, not an adversarial security boundary.
Git hooks are local and are not shipped by cloning this repository.
Review hooks may spend provider quota. Do not enable or fire them for tasks
that prohibit review execution.

## Release checklist

1. Run `make install`, `make check`, and `make coverage`.
2. Check CLI help, protocol fields, provider mappings, local document links,
   and American English. Inspect rendered documentation after layout changes.
3. Verify the intended version, executable entry, repository URL, and MIT
   license in `package.json`; only the operator decides a version bump.
4. Move approved Unreleased entries into the chosen dated release section.
   Check release/comparison links and distinguish corrections from original
   released behavior.
5. With separate publishing authorization, create the tag and release.
   Source releases must retain the launcher, runtime config, source, package
   metadata, and license. Do not advertise binary assets unless attached.
6. Keep published release notes consistent with the changelog. The v0.1.1
   JSON-safety correction and the v0.2.0 summary still need operator publication.
   Use each corrected changelog section as the source of the release text.
   After saving the chosen section to a reviewed notes file, use
   `gh release edit <tag> --repo bindsch/usagemux --notes-file <notes-file>`.
