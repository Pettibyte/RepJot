# Stop discovery churn

## Diagnosis

This is not just a weak fixer problem. The workflow repeatedly pays for discovery, loses parts of the diagnosis, then repeats discovery.
The current prompts already demand authority, reproductions, and root-cause families. More instructions of that kind alone will not fix the process.
Their dispatch rules undermine those demands.

A reviewer must deliver a repairable defect, not merely demonstrate that the implementation is imperfect.
The next review must answer whether that defect is fixed, not search indefinitely for a stronger implementation contract.

## Session audit

The audit covered both requested sessions, linked children, handoffs, final outputs, report writes, and selected tool evidence.
It did not re-review the product or resume the audited sessions. The evidence supports process findings, not a fresh product acceptance verdict.
References identify session prefixes and JSONL entry IDs. Times are UTC.

### `01a07997-4c2f-73b5-9ee1-b02452c6e2d5`

This audit followed 25 linked children. It found eight stable blocking families and one optional finding.
The recorded work ended without Phase 10 acceptance or a commit.

| Observed failure | Historical evidence | Consequence |
| --- | --- | --- |
| Known defects disappeared from acceptance | R0 adversary `01a07a23-e949`, entry `0c389cc3`, September 7, 05:07, reported eight contract defects. R1 judge `01a07ad4-3764` received that report in `1dc41a58`, then declared the task complete in `e757a6c4` after D001 verification. | Narrow verification became unsupported whole-phase acceptance. The judge possessed the other findings. |
| A child received no valid repair assignment | Parent entry `e5134f83` sent `{"prompt":1.23456789}` to `01a07b11-b073`. The child asked for instructions in `a5c03b21`. Parent `036f19e2` later credited it with linear schema validation. | Claimed implementation work did not occur. R2 subsequently reproduced six blocking families. |
| Fixers narrowed the governing invariant | The executable-inventory repair restated all executable output as external `.js` plus inline scripts in `01a07c50-16ca`, entry `a9537ce7`. R6 found referenced `.mjs` bypasses. | A selected representation replaced the actual contract boundary. |
| Known OAuth limitations survived verification | Fixer `01a07c50-16ca`, entry `2b444fa4`, admitted concatenated-scope blindness. R8 judge received the limitation in `01a07d6b-e662 / b39cdf81`. Adversary `01a07d6b-e673 / 227c19b9` then demonstrated accepted broad scope using two constant fragments. | This was missed known coverage, not a new product requirement or a newly introduced regression. |
| Residual risks contradicted completion summaries | Fixer `01a07d44-a546 / 91365eef` disclosed incomplete loop-head scope handling. Its final `abdb98b7` said “Root cause fixed.” R8 reproduced scope and assignment failures. | The handoff understated an unresolved contract limitation. |
| Artifact instructions contradicted closure | Parent `34faa2e8` ordered restoration of `dist`. Fixer `01a07cc7-2e5c / 0951ecec` reported the resulting stale HTML. R6 reopened that mismatch. Parent `32ff614c` later required retained changes and clean Git status without a commit. | Generator correctness, synchronized output, and cleanliness against HEAD became conflicting goals. |

Three popup repair submissions were followed by R6, R7, and R8 rejection.
At R8, 774 tests and 2,837 assertions passed, but independent probes still found contract failures.
The history also contains eight HTTP 502 errors in one mechanical child. That is a provider failure, not evidence of bad analysis.
Parent intervention and manual rollback added another interruption after the user challenged the parent's editing authority.

### `01a07d88-87f8-73b5-9ee1-b0866dbadec2`

This audit followed 22 linked children: six analyst attempts, ten fixers, and six judges. All six judges rejected.
The evidence spans September 7–8, 2026.

| Observed failure | Historical evidence | Consequence |
| --- | --- | --- |
| Known acceptance categories disappeared from later packets | Analysts `01a07dc9-dae2 / 5b354cfa` and `01a07dc9-5bd5 / 65dbe62e` covered aliases, lexical identity, branches, ordered writes, and invocation equivalents. Parent `7abba387` later sent a narrower sink-resolution request and prohibited test edits. | Later rounds rediscovered categories already present in the diagnosis. |
| Required regression tests were absent | Judge `01a07e0c-128c / 94b24077`, September 7, 22:51, found the claimed regression cases missing. | The parent did not enforce requirements already present in the fixer instructions. |
| Failure routing followed labels instead of causes | D004 edit `01a07e73-b8fc / 18a2db5b` introduced scope-insensitive lookup and premature cycle detection. Parent `5893357d` blamed 15 failures on D005. Repair `01a07ea1-b87c / f0da9eb1` instead changed D004's `collectScopeSinks`. | Several failing popup cases shared a different gate failure. They were not independently proven D005 regressions. |
| The judge's causal handoff omitted a second blocking path | Judge `01a07ee3-d2d3 / 80215fe7` observed “the build output does not contain the required Drive app-data scope.” Its report `114ede3d` focused on first-value retention in sink analysis. Parent `d8ddc0e7` forwarded that repair. Fixer `01a07ee7-9eea / 1cd14e56` reproduced the same literal-gate failure afterward. | First-value retention was real, but the command evidence did not isolate it as the sole cause. The fixer inherited an incomplete diagnosis. |
| Selected green tests concealed incomplete shared behavior | Fixer `01a07ed0-e138 / 33665da0` passed 87 command tests. Final `7977de8b` disclosed a 10-hop alias limit. Judge `01a07ee4-0223 / 1b27af9b` then ran 21 probes, with seven failures. | Several failures matched earlier analysis. The new hop limit was a repair limitation, not a product requirement. |
| Shared-tree interference invalidated some results | Despite the user's sequential constraint in parent `d783106a`, parent `81d144b2` showed a judge and fixer active together. Judge `01a07ebd-79fb / 9d746dcb` and `cab5c5a5` encountered missing generated files. | The full-suite failures were not a stable defect count. Rebuilt, isolated reproductions were stronger evidence. |

Persistent command tests grew from 76 to 80, 82, and 87 as judges added tests.
The last sign-off round left one D004 and seven D005 failures in temporary probes instead of that suite.
Two analyst attempts ended with explicit usage-limit errors. Shorter replacement prompts did not address that cause.
The history also contains a probe written outside the container's accessible path, which made its command fail operationally.

### What this says about Sol

Sol found real defects, sometimes wrote useful failing tests, and sometimes received information that its verdict failed to account for.
Some later findings were known omissions. Others arose from incomplete repair machinery. They were not all invented hardening.
The earlier audit kept symlink traversal optional and excluded dynamic evaluation and hostile-runtime assumptions.
Its scope and popup findings used ordinary static ES2019 forms.

The record therefore does not support “the judge always knows the complete cause.” One causal handoff was demonstrably incomplete.
It does support a stronger requirement: the discovering reviewer must preserve its observations, explain its diagnosis, and disclose uncertainty.
The orchestrator must refuse acceptance while known findings lack dispositions, regardless of a judge's optimistic summary.

No reliable total token cost or wall-clock saving was calculated. Session counts do not establish either.

## Template audit

| Template | What works | What causes churn | V2 replacement |
| --- | --- | --- | --- |
| Orchestrator | Explicit authority, sequential work, defect consolidation | Fresh sessions after changes, full final rediscovery, repeated full batteries, root-cause resets | One bounded pipeline, role reuse, one batch, confirmation mode |
| Judge | Required workflow, expected/observed behavior, diagnosis fields | Entire boundary on every pass, disposable external probes, no mandatory executable handoff | Discovery once, persistent red test and valid control, diagnosis before handoff |
| Adversary | Operating-model limits, equivalent-case search | Broad generic attack menu, no equally precise diagnosis contract, disposable probes | Approved risk table, boundary-specific tests, same repair-packet standard as judge |
| Builder | Simple design, authoritative scope, negative tests | Duplicate packet reconstruction and completion reports | One shared requirement matrix and implementation evidence |
| Logic fixer | Reproduction before repair, adjacent tests | Cannot read the full evidence record, generic self-adversarial battery regardless of actual requirements | Shared complete packets, causal batch repair, affected invariants |
| Mechanical fixer / repair-builder | Distinguish mechanical and architectural work | Extra dispatch decisions and repeated context without different acceptance rules | One fixer, explicit permitted scope per defect |
| Root-cause analyst | Questions unsupported guarantees | Starts only after another rejection, forbids proposing code, repeats the reviewer's investigation | Discovering reviewer supplies diagnosis immediately |
| Ledger | Stable IDs and explicit dispositions | Private state plus packets, reports, and revision history duplicate facts | One shared current-state task file, durable tests, linked logs |
| Supervisor | Sequential phase progression | Placeholder model and quota retry machinery add another autonomous loop | No supervisor in v2. One phase, then stop |

Concrete contradictions in the current orchestrator include:

- Lines 74–78 both assign Muse to logic/redesign work and restrict it to mechanical work.
- Lines 117–119 name Qwen despite different model routing earlier in the file.
- Line 66 names `yield_subsession`, which is not the available `yield_to_subsessions` tool.
- Line 121 withholds private cases and the ledger despite the later requirement to transfer accepted probes.
- Line 135 orders a fresh full review rather than repair confirmation.
- Line 145 orders a fresh analyst, fixer, and judge after a reopened family.
- Lines 151–159 prohibit useful role reuse after repository changes.

These line references describe the working-tree template examined during this audit. It already contained user changes.
No existing template was modified for this proposal.

## Requirement traceability must constrain the test oracle

A source citation is necessary but insufficient. The reviewer must explain why the source requires the exact expected result.

The local report `R9-judge-D004-signoff.md` illustrates the distinction.
It cites the exact OAuth scope and fail-closed bundle gate, then requires assignment resolution by lexical binding and source position.
The report demonstrates a rejected valid-scope program. That is concrete behavior evidence.
But a fail-closed rule alone does not establish acceptance of every statically evaluable program.
The packet must establish which generated forms the authoritative build contract must accept, using the full authority chain.

An actual broader-scope authorization bypass is different. It directly contradicts the exact-scope requirement.
Both cases need evidence, but their authority arguments are not interchangeable.
This audit does not decide the product's complete supported syntax policy or dismiss the whole D004 family.
V2 requires that decision before the fixer builds another layer of symbolic analysis.

The same rule protects legitimate edge cases. An explicit unlimited-input contract cannot be weakened by calling deep inputs optional hardening.
Requirement traceability must prevent both invented work and unjustified exclusions.

## KISS design

### 1. Freeze the contract, not a secret answer key

All roles share the same scope, authoritative requirements, expected outcomes, and known defect evidence.
Initial independent cases can remain separate from the builder where the implementation plan requires this.
Once a case exposes a defect, secrecy ends. The complete evidence goes to the fixer.
Independent review means independent reasoning. It does not require discarded tests or withheld diagnoses.

### 2. Make the reviewer finish its work

Each discovering reviewer owns the requirement argument, reproduction, causal explanation, equivalent cases, and closure criteria.
A failing unit test is preferred, not mandatory theater. Command and browser defects need evidence at their actual boundaries.
A manual defect needs exact steps and observations. An unexecuted test is not proof.
An unknown cause remains explicitly unknown. The reviewer still supplies a deterministic reproduction and bounded investigation target.
An incomplete handoff returns to its author once. It never becomes an unexplained fixer assignment.

### 3. Repair one batch

The fixer receives every accepted packet, not an orchestrator's shortened paraphrase.
One fixer session repairs the batch, with changes grouped by cause.
The fixer runs original failures before editing and preserves reviewer assertions through the repair.
There is no mechanical-versus-logic-versus-redesign routing tree and no root-cause subsession.
A repair outside approved ownership stops for a decision instead of silently expanding Phase 10.

### 4. Separate discovery from confirmation

The first judge pass covers the entire assigned requirement matrix and returns all observed defects together.
The next pass examines the repair diff, original counterexamples, equivalent cases, and directly affected invariants.
Unchanged requirements keep their valid evidence. New production changes invalidate relevant evidence, not every past conclusion.
The same judge retains context but must inspect the actual changed snapshot.
A late real defect remains blocking. Its packet identifies an incomplete fix, repair regression, or earlier review miss.

### 5. Make adversarial work specific and useful

Routine work has no adversary. High-risk work gets one approved, requirement-backed probe plan after contract confirmation.
The adversary targets cross-boundary assumptions rather than repeating the judge's checklist.
It preserves tests and shares its causal diagnosis under the same packet standard.
The judge verifies the resulting repair. Another adversary is not automatic.
A materially changed trust boundary requires a revised plan and explicit authorization.

### 6. Stop spending automatically

The normal budget is two judge invocations, including confirmation. High-risk work adds one adversary and at most one further judge confirmation.
An invocation means a substantive review pass, even when the same session continues.
A failed confirmation stops the pipeline with complete evidence. The user chooses the next bounded action.
The budget never turns a failed test into acceptance. It makes additional spending visible and optional.

### 7. Let tests carry the defect history

A new issue database, event stream, or custom tracking service would add machinery without fixing the handoff.
V2 uses one shared task file for current state, requirement links, diagnosis, and evidence paths.
Regression tests preserve executable knowledge. Logs preserve observations. Snapshot manifests identify the tested dirty tree.
The file is not a second chronological ledger. There are no parallel private packets or per-role completion reports to reconcile.
The parent still performs authority-required final diff inspection and gate execution.

## Prompt size and validation

The old runtime set contains 4,976 whitespace-delimited words across ten files.
V2 contains 2,776 words across five role prompts, the shared protocol, and the task template: about 44% fewer.
The orchestrator decreases from 1,621 to 647 words. Human-facing strategy and adoption guides are outside those runtime counts.
Shared protocol loading changes each role's input size. These figures do not claim equal per-invocation token reductions.
The primary savings mechanism is fewer repeated investigations, not word count alone.

Static validation examined all nine Markdown files for trailing whitespace and local Markdown links. It passed.
A workflow walkthrough covered clean acceptance, complete repair batches, incomplete packets, late defects, high-risk repair, and prior-phase ownership conflicts.
The expected outcomes preserve required gates and stop failed confirmation without automatic rediscovery.
No production tests ran because this change contains only new prompt and strategy files.
No live implementation trial was performed. These results establish document consistency, not operational effectiveness.

## Adoption and evaluation

V2 requires the procedural approval described in [README.md](README.md). Creating these files does not activate them.
The existing product contracts, phase ownership, mandatory gates, and human approvals remain binding.

Evaluate the next bounded task against these outcomes:

| Measure | Target |
| --- | --- |
| Incomplete packets sent to fixers | Zero |
| Known reviewer probes discarded | Zero |
| Blocking expectations without exact authority arguments | Zero |
| Automatic root-cause sessions | Zero |
| Routine substantive judge passes | At most two |
| High-risk substantive judge passes / adversary passes | At most three / one |
| Rediscovery of a previously diagnosed cause | Zero |
| Late real defects | Report honestly, classify, and stop the automatic loop |

No prompt can guarantee perfect discovery in one pass. These prompts can make scope, handoff quality, and stopping behavior explicit.
Actual token and time savings require measurement during use. Shorter prompt text alone is not proof of lower cost.
