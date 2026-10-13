---
read_when:
  - Checking the historical evidence behind the 0.2.0 provider additions.
---

# Historical report: usagemux 0.2.0 alignment

**Historical evidence from 2026-10-10, condensed and corrected on 2026-10-13.**
These are observations of one installation, not current product guarantees.
See the [provider guide](../PROVIDERS.md) and [protocol](../PROTOCOL.md) for
current behavior.

## Scope and provenance

The work added Kimi and Antigravity mappings, classified OpenHands as
provider-agnostic, and added advice for recognized credential and timeout
errors. This summary replaces references to an unshipped scratch audit.
Release changes are recorded in the [changelog](../../CHANGELOG.md).

The original branch was `align-0.2`, based on v0.1.1. The released v0.2.0
commit is `f392189`. The original report inspected
`/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI` on macOS.
It did not record the backend version, digest, OS version, architecture,
complete environment, or exact live-run commit. Those identifiers are unknown.
The currently installed backend cannot establish the historical binary's identity.

Binary strings suggested Kimi, Antigravity, Copilot, and ClinePass provider
support and credential routes. String inspection alone did not validate
every route. The Kimi credential inspection reported object field names and
non-secret scope/token-type metadata. Access-token and refresh-token values
were not reported as inspected or printed; the original blanket claim that
no values were read was inaccurate.

## Recorded live observations

These outputs come from the original report. A separate current Kimi check
is recorded in [installation compatibility evidence](../INSTALLATION.md#compatibility-evidence).

```text
$ ./bin/usagemux snapshot --client kimi
kimi: ok
  primary: 81% remaining; resets 2026-10-16T17:27:55.000Z
  secondary: 5% remaining; resets 2026-10-10T00:27:55.000Z
```

Reported exit: 0. A later snapshot reported an expired credential.

```text
$ ./bin/usagemux snapshot --client agy --timeout 90
agy: ok (offline)
  antigravity-offline-conversations: unknown remaining; reset unknown
```

Reported exit: 0. The report says the default timeout expired with the IDE
closed; it did not preserve that command's complete output or elapsed time.

`./bin/usagemux snapshot --client copilot` reportedly exited zero with an
`error` result: no available fetch strategy, followed by credential advice.
This indicated missing authentication on that machine, not universal lack of
Copilot support.

A full snapshot in the sandbox reported a Claude probe-directory failure.
The report proposed sandbox restrictions as the cause, but did not include a
same-version unsandboxed comparison. That explanation remains a hypothesis,
not evidence that a regression was excluded.

## Recorded verification

The original report recorded:

```text
make check
56 pass
0 fail
108 expect() calls
```

It reported TypeScript checking and `sh -n bin/usagemux` exiting zero.
The test count increased from 43 at v0.1.1 to 56 at v0.2.0.
Its separate spelling check used the operator's private
`~/.claude/skills/humanizer/scripts/check_american.py`; that script was not
part of the repository or its full gate.

The old universal remedy claim was false. The final implementation only
appended advice under the two [documented conditions](../PROTOCOL.md#errors-and-escaping).
Implementation details and review-round corrections have been folded into the
current references rather than retained as competing descriptions here.
