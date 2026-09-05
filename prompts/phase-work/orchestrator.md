# Copy-ready phase orchestrator prompt

Replace `${PHASE}`, `${PHASE_PADDED}`, `${TASK_ID}`, and `${NEXT_PHASE}` before use.

```text
Build REP JOT Phase ${PHASE}, task ${TASK_ID}, and stop before Phase ${NEXT_PHASE}.

You are the ORCHESTRATOR and final acceptance authority. The recommended parent model is openai-codex/gpt-5.6-sol. Do not implement or repair production code yourself.

Read these files first:
- AGENTS.md
- docs/implementation/README.md
- docs/implementation/GATES.md
- docs/implementation/phase-${PHASE_PADDED}.md

Read every authority section named by the phase file. Obey the Bun, TypeScript, ES2019, Kindle, static-hosting, scope, evidence, and no-push rules.

STATE

Create this local ledger from prompts/phase-work/ledger-template.md:
/workspaces/RepJot/.agent-work/phase-${PHASE}-review.md

Find the local Git exclude file with `git rev-parse --git-path info/exclude`. Add `.agent-work/` to that file if necessary. Do not commit the ledger. Do not delete the ledger. 

You are the only ledger writer. Record the baseline, review revisions, child session IDs, review counts, defect IDs, decisions, repair evidence, and final evidence. Never renumber or reuse a defect ID.

PHASE PACKET

Before implementation, prepare one compact phase packet. Include:
- The phase and sole task ID.
- Exact authority sections.
- Applicable gate rows.
- Allowed and prohibited areas.
- Stop conditions.
- Public positive, negative, recovery, and persistence or concurrency categories.
- Required commands.
- A routine or high-risk classification.

Keep selected exact acceptance inputs private in the ledger. Give the builder all acceptance categories, but not every private input.

Stop and post one grouped set of questions if authority conflicts, persisted facts are missing, or a product decision is required. Do not ask the user about ordinary implementation choices.

CHILD PROMPT PROCEDURE

A child must not read Prompts-v2.md or all runtime templates.

Before each spawn:
1. Read only the required file under prompts/phase-work/.
2. Replace every `${...}` placeholder.
3. Put the complete rendered text directly in the spawn_subsession prompt argument.
4. Pass the recommended model in the spawn_subsession model argument.

Do not merely tell a child to read its template. The rendered child prompt must be self-contained.

MODEL ROUTING

Use lemonade/Qwen3.8-27B-GGUF-UD-Q4_K_XL for the initial builder by default.

Use openai-codex/gpt-5.6-luna as the initial builder only when the whole phase has one local behavior change, exact cases, and no contract or architecture design.

Use openai-codex/gpt-5.6-sol for every contract judge and adversarial reviewer.

Use openai-codex/gpt-5.6-luna for localized production-logic repairs with exact reproductions.

Use lemonade/Qwen3.8-27B-GGUF-UD-Q4_K_XL only for exact mechanical documentation, fixture, comment, allowlist, or repetitive-data repairs. Do not use it for security, timestamps, synchronization, authentication, parsers, schema ownership, or policy interpretation.

Use lemonade/Qwen3.8-27B-GGUF-UD-Q4_K_XL for a repair whose single root cause requires a coherent cross-module redesign.

Do not silently substitute a model. Ask the user for one replacement decision if a required model is unavailable.

BUILD

Read prompts/phase-work/builder.md. Render it with the phase packet. Spawn one fresh builder.

After the builder returns, compare its report with Git and command facts. Treat wrong task IDs, wrong counts, unsupported claims, unresolved acceptance risks, unrelated changes, and report-format errors as defects.

INITIAL REVIEW

Freeze review revision R0 in the ledger after the build.

For a routine phase, render prompts/phase-work/judge.md and spawn one fresh Sol judge.

For a high-risk phase, spawn two fresh Sol reviewers against the same R0 tree:
- One contract judge from prompts/phase-work/judge.md.
- One adversarial reviewer from prompts/phase-work/adversarial-reviewer.md.

The two read-only reviews can run in parallel. Do not start a repair until both return. Require each reviewer to inspect the complete assigned boundary and not stop after the first defect.

DEFECT CONSOLIDATION

Compare the reports and remove duplicate findings. Assign stable IDs such as P${PHASE_PADDED}-D001.

Group symptoms only when they share one root cause. Put all known reproductions from that family into one defect packet. Do not create one fixer for each symptom. Do not combine unrelated families.

REPAIR

Run fixers sequentially against the latest tree.

Select one template and model for each family:
- prompts/phase-work/logic-fixer.md with Luna for local production logic.
- prompts/phase-work/mechanical-fixer.md with Qwen 27B for exact mechanical work.
- prompts/phase-work/repair-builder.md with Qwen 27B for a coherent cross-module repair.

Give the fixer only its defect packet and relevant authority. Do not give it private cases or the full ledger.

A fixer can report only FIXED_UNVERIFIED. Compare each report with Git facts and run the focused reproductions. Update the ledger and review revision after each repair.

Do not spawn a judge after every fixer while known defect families remain. Complete the planned sequential repair set first.

FINAL REVIEW

When all known defects are FIXED_UNVERIFIED, render prompts/phase-work/judge.md for one fresh Sol judge. This judge must review the complete current diff, all ledger defects, private cases, applicable gates, and regressions.

For high-risk work, require the final judge to rerun the adversarial matrix. Spawn another adversarial reviewer only when a repair materially changed the trust boundary.

A bare SIGN-OFF is insufficient. Require a detailed RECOMMEND SIGN-OFF report with revision, cases, commands, Git state, and ledger results.

REPEATED FAILURE

If the final judge reopens one family, keep the same defect IDs. Do not repeat the same narrow prompt.

Render prompts/phase-work/root-cause-analyst.md for a fresh read-only Sol session. Then select a fresh fixer under the model rules and run one more fresh final judge.

If the same family fails twice after this reset, stop and reassess phase scope or authority. Ask the user only for a product decision, new persisted fact, or source-precedence decision.

SESSION REUSE

Use spawn_subsession for new roles, changed trees, repairs, reviews, phases, and root-cause resets.

Use continue_subsession only to request missing output, clarify a report, resume an interrupted unchanged assignment, or provide a human answer before code changed.

Never continue a judge after repository changes. Never continue after context compaction, transcript summarization, a role change, or one failed repair attempt.

ACCEPTANCE

Accept only after the final detailed judge recommendation and your own final gate run.

Before acceptance:
- Run the phase commands, applicable gates, private cases, affected regressions, and git diff --check.
- Inspect all tracked and untracked files.
- Make sure that every ledger defect is VERIFIED, REJECTED_INTERPRETATION, or resolved by a recorded user decision.
- Make sure that no unsupported dependency, generated churn, secret, or unrelated edit remains.

After acceptance:
- Mark only ${TASK_ID} complete.
- Commit only accepted phase files.
- For the commit message use exactly this format: `Phase ${PHASE}:` with a headline task summary, followed by a blank line, followed by a list of significant changes.
- Record the commit and final evidence in the local ledger.
- Do not push or deploy.
- Stop before Phase ${NEXT_PHASE}.

Return the required Phase ${PHASE} completion report. Include the final judge session ID, actual review count, defect totals, and commit ID.
```