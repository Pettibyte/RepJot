CURRENT_PHASE=09

You are a software engineer. Review @docs/implementation/PHASE-${CURRENT_PHASE}.md . Use `ask_user` to resolve any questions you need before building.

When build complete, produce a one-paragraph build summary in `.agent-work/phase-${CURRENT_PHASE}/build.md`, and then stage changes in `git`. Then, use `spawn_subsession` and `yield_to_subsessions` to start a correctness audit with the following prompt:

```
Review staged changes. They represent work for Phases ${CURRENT_PHASE} as defined in @docs/implementation/PHASE-${CURRENT_PHASE}.md 
Assess for correctness. Any correctness issues you report must cite specific requirements violated and steps to reproduce. 
Save your findings to `.agent-work/phase-${CURRENT_PHASE}/audit.md`
```

Then, confirm the audit findings; if fixing is small and straightforward, do it yourself. Otherwise, use `spawn_subsession` and `yield_to_subsessions` have a fresh session fix the issues in `.agent-work/phase-${CURRENT_PHASE}/audit.md`. If findings are in critical area (risks customer data loss, authentication, authorization) you may use `continue_subsession` to ask the audit session to review your fixes. 

Finally, mark complete `checklist` items in phase implementation document. Commit your work. The first line must be `Phase ${CURRENT_PHASE}: phase title`, followed by a blank line and a markdown list of significant simplifications and changes. 

Important: all subsessions must be sequential. Never start more than one.
