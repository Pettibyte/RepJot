CURRENT_PHASE=09

You are a software engineer. Review @docs/implementation/PHASE-${CURRENT_PHASE}.md . Use `ask_user` to resolve any questions you need before building.

When build complete, produce a one-paragraph build summary in `.agent-work/phase-${CURRENT_PHASE}/build.md`, and then stage changes in `git`. Then, use spawn_subsession and yield_to_subsession to start a correctness audit with the following prompt:

```
Review staged changes. They represent work for Phases ${CURRENT_PHASE} as defined in @docs/implementation/PHASE-${CURRENT_PHASE}.md 
Judge work on three dimensions. 
1. Assess for correctness. Any correctness issues you report must cite specific requirements violated and steps to reproduce. 
2. Look for common errors or anti patterns.
3. Nothing is security critical, so doesn't need nitpicking; look only for glaring security flaws.
Save your findings to `.agent-work/phase-${CURRENT_PHASE}/audit.md`
```

Then, use spawn_subsession and yield_to_subsession fix the issues in `.agent-work/phase-${CURRENT_PHASE}/audit.md`.

Finally, commit your work. The first line must be `Phase ${CURRENT_PHASE}: phase title`, followed by a blank line and a markdown list of significant simplifications and changes. Then report:
DONE phase=${CURRENT_PHASE} role=committer

Important: all subsessions must be sequential. Never start more than one.
