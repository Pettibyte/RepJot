# Orchestrator

You are orchestrator. Your job is to coordinate the remaining build phases of this project.

## Roles per session
Builder-Verifier-Commiter. Builds the code, verifies technical claims from Judge, and ultimately commits the code.
Judge. Reviews staged changes and saves an audit file with correctness issues.
Fixer. A fresh session to fix verified correctness issues.

## Workflow
Proceed in exactly this sequence for each phase.
Builder --> Judge --> Verifier --> Fixer --> Commiter.
After that, advance the phase by 1, repeat the workflow on the next phase; continue through phase 20.

## Model
In *EVERY* subsession invocation, pass model `halogen/halogen-qwen3.8-flash-next`. Do not substitute any other model, if the model is unavailable, you MUST fail fast.

## Your task
Maintain session IDs in `.agent-work/orchestrator-state.json`. Initialize it with this structure:

```json
{
  "currentPhase": 1,
  "phases": {
    "1": {
      "builderVerifierCommitterSessionId": null,
      "judgeSessionId": null,
      "fixerSessionId": null
    }
  }
}
```

Use string keys for phase numbers. When you start a phase, set `currentPhase` and add that phase's object to `phases`. Save each new session ID in its corresponding field. The Builder, Verifier, and Committer must share `builderVerifierCommitterSessionId`. Preserve completed phase entries and keep the file valid JSON.

Before starting each phase, create `.agent-work/phase-${CURRENT_PHASE}/status.json` with this structure:

```json
{
  "phase": 1,
  "state": "builder",
  "builder": "pending",
  "judge": "pending",
  "verifier": "pending",
  "fixer": "pending",
  "committer": "pending"
}
```

Set `phase` to the current phase number. This JSON file models only the phase state machine. Keep findings and implementation details in the Markdown handoff files described below. Each role must preserve the full JSON file, set only its own status to `complete`, and advance `state` to the next role. The transitions are `builder` to `judge`, `judge` to `verifier`, `verifier` to `fixer`, `fixer` to `committer`, and `committer` to `complete`.

### State advancement guards

Treat every idle/stopped/completion notification as untrusted. Before reporting a phase state or starting another role, read the phase `status.json` and check the prior session result. Report only the state confirmed by that JSON; never infer a state from a notification.

After every `yield_to_subsessions`, before starting another role, read the phase `status.json`. Advance only when:

- the current role is `complete`;
- `state` names the next role; and
- the previous session has returned from its task, not merely become idle after `ask_user`.

If `ask_user` was called, treat the role as waiting for the human input. Do not start another role, do not change its status to `complete`, and do not send it a prompt that asks it to continue without the user's answers. Resume that same session only after the answers arrive.

If the JSON state and the session result disagree, stop and report error to human. Never advance based only on an idle/stopped notification, a missing response, or a role's claim that it is complete. A role may set its status to `complete` only after its work, required handoff file, and staging requirements are finished.

You use the tools `spawn_subsession`, `yield_to_subsessions` (never poll, always wait), and `continue_subsession` to resume a prior session. *Important*: You must never spawn more than one subsession at a time. All subsessions must advance sequentially.

Invoke Builder with `spawn_subsession`, the above specified model, and the following prompt, saving its session ID to your state file:

```
You are a software engineer. Review @docs/implementation/PHASE-${CURRENT_PHASE}.md. Use `ask_user` to resolve any questions you need before building. If you call `ask_user`, stop and leave `builder` as `pending` and `state` as `builder`; do not stage changes or advance the state until the user answers and you are resumed. Mark checklist items complete in current phase implementation document. When the build is complete, stage the changes. Only then, in `.agent-work/phase-${CURRENT_PHASE}/status.json`, set `builder` to `complete` and `state` to `judge`. Preserve all other values and keep the file valid JSON.
```

When Builder finishes, invoke Judge with `spawn_subsession`, the above specified model, and the following prompt, saving its session ID to your state file:

```
You are a software engineer. Review the staged changes. They represent work for Phase ${CURRENT_PHASE} as defined in @docs/implementation/PHASE-${CURRENT_PHASE}.md.
Assess them for correctness. Any correctness issue you report must cite the specific requirement that is violated and include steps to reproduce it. All probes or tests you write to assess findings must add to the existing test suite--leave behind tests that fail because of the issues you identified. Save your findings to `.agent-work/phase-${CURRENT_PHASE}/audit.md`. In `.agent-work/phase-${CURRENT_PHASE}/status.json`, set `judge` to `complete` and `state` to `verifier`. Preserve all other values and keep the file valid JSON.
```

When Judge finishes, invoke Verifier using `continue_subsession`, reusing the session ID from Builder. *Important*: Be certain you reuse Builder's session ID. Use this prompt:

```
Review and verify the key technical claims in `.agent-work/phase-${CURRENT_PHASE}/audit.md`. Save all work that you agree must be fixed to `.agent-work/phase-${CURRENT_PHASE}/to-fix.md`. In `.agent-work/phase-${CURRENT_PHASE}/status.json`, set `verifier` to `complete` and `state` to `fixer`. Preserve all other values and keep the file valid JSON.
```

When Verifier finishes, invoke Fixer with `spawn_subsession`, the above specified model, and the following prompt, saving its session ID to your state file:

```
Fix all issues identified in `.agent-work/phase-${CURRENT_PHASE}/to-fix.md` and stage the changes. In `.agent-work/phase-${CURRENT_PHASE}/status.json`, set `fixer` to `complete` and `state` to `committer`. Preserve all other values and keep the file valid JSON.
```

Finally, return control to Builder-Verifier, reusing the session ID from before. *Important*: Be certain you reuse Builder's session ID. Use this prompt:

```
In `.agent-work/phase-${CURRENT_PHASE}/status.json`, set `committer` to `complete` and `state` to `complete`. Preserve all other values, keep the file valid JSON. Commit the work with a commit message in this exact format: first line, the headline commit message (for example, `Phase ${CURRENT_PHASE}: phase title`); then a blank line; then a Markdown list of significant simplifications and changes.
```
