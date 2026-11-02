---
read_when:
  - Troubleshooting executable discovery or assessing subprocess guarantees.
---

# Backend reference

usagemux invokes CodexBar directly without a shell:

```text
codexbar --provider <provider> --format json --json-only
```

The executable path is resolved before launch. The child runs from that
executable's directory with stdin ignored. Credentials are not placed in
argv; provider credential variables remain available in its environment.

## Discovery and trust

CodexBar lookup examines absolute, nonempty `PATH` entries in order.
Each `codexbar` candidate is resolved through symlinks. The first accepted
candidate wins. Missing, inaccessible, non-executable, and rejected candidates
are skipped; no accepted candidate means unavailable.

On macOS and Linux:

- The resolved executable must be a regular executable file owned by the
  current user or root, without group or world write permission.
- Its resolved parent directory must be outside the current working directory
  and its descendants. This is not a repository-wide exclusion: when invoked
  from `src/`, a backend elsewhere in the same checkout can pass.
- Every resolved directory ancestor through the filesystem root must be a
  directory owned by the current user or root and must not be world-writable.
  Group-writable directories are not rejected by this check. Sticky
  world-writable directories are still rejected.

Discovery validates the resolved target's directory chain, not every alias
directory used to reach it. Immediately before every spawn, usagemux re-runs
the full discovery validation on the executable: it resolves symlinks again
and requires the same regular-file, ownership, permission, executable-bit,
directory-chain, and working-tree rules. The spawn runs the re-resolved real
path, not the path discovery returned, so an executable replaced by a
symlink after discovery is refused instead of executed. Discovery, the
rebuilt child `PATH`, and the child environment are resolved once per
snapshot and shared by every provider call in it, so the re-check closes
most of the window between discovery and a later spawn. These checks are
not a sandbox, do not validate backend code or signatures, and do not
prevent replacement between the re-check and the exec itself. Install only
a backend you trust.

The shell launcher uses separate [Bun lookup rules](INSTALLATION.md#launcher-troubleshooting).
Its fixed locations are not the CodexBar search path.

## Environment

The child receives a copy of the environment, with `PATH` rebuilt from
absolute, resolvable, trusted directories using the same directory-chain
checks. Resolved duplicate directories are removed, preserving order. The
rebuilt environment is computed once per snapshot and shared by every
provider call in that snapshot.

The following variable names are removed case-insensitively:

```text
BASH_ENV BUN_OPTIONS ENV JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS
NODE_OPTIONS NODE_PATH PERL5LIB PERL5OPT PYTHONHOME PYTHONPATH
RUBYLIB RUBYOPT _JAVA_OPTIONS
```

All names beginning with `DYLD_` or `LD_` are also removed. This is a
specific denylist, not removal of every setting that could influence a backend.
Other variables, including credential variables, remain.

Before starting Bun, the launcher unsets `BUN_OPTIONS` and `NODE_OPTIONS`.
It passes `--no-env-file --no-install` and the package's explicit
`bunfig.runtime.toml`, preventing caller dotenv and Bun configuration loading.

## Execution and limits

Selected applicable providers run concurrently. Results retain client order
and are emitted together after collection. There is no concurrency option,
retry loop, or overall command deadline.

| Limit | Scope |
| --- | --- |
| Provider timer | [CLI timeout](CLI.md#selection-and-options); starts after process spawning, and races output collection plus process exit. Discovery and environment preparation happen once per snapshot, before the first provider call. |
| stdout | 512 KiB (524,288 bytes) per provider call. |
| stderr | A separate 512 KiB limit per provider call. |
| Failure detail | Trimmed stderr is limited to the first 8,192 JavaScript string code units, followed by an ellipsis if truncated, when a nonzero exit has no non-null JSON payload. |
| Timeout grace | 250 ms after SIGTERM, then SIGKILL and cleanup. |
| Cleanup cap | After SIGKILL, cleanup waits at most 2 seconds for the original process and output readers, then cancels the output streams and releases the call with its error. |

Structured JSON error messages are subject to the stdout byte limit, not the
8,192-unit stderr detail limit. Malformed JSON takes precedence over failure
stderr; see [error interpretation](PROTOCOL.md#errors-and-escaping).

On macOS and Linux, each call starts a detached process group. A timeout
signals the original group with SIGTERM, then SIGKILL after the grace period.
Output overflow and other caught execution errors trigger SIGKILL without
that grace period. Signaling falls back to the original process if group
signaling fails.

Descendants that leave the original process group are outside this mechanism.
Cleanup waits for the original process and output readers for at most
2 seconds after SIGKILL. If the cap fires, the output streams are canceled,
which closes the pipes and lets the call return while the escaped descendant
is still running. The cap's timer is cleared once cleanup settles, so a call
whose cleanup finishes early does not keep the process alive until the cap.
Discovery, environment preparation, spawning, and cleanup are outside the
provider timer's strict scope. The timeout is therefore not a hard command
deadline or a guarantee that every descendant has terminated.
