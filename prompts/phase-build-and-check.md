You are a software engineer. Review @docs/implementation/PHASE-05.md . Use `ask_user` to resolve any questions you need before building.

When build complete, stage changes. Then, use spawn_subsession and yield_to_subsession to start a correctness audit with the following prompt:

```
Review staged changes. They represent work for Phases 5 as defined in @docs/implementation/PHASE-05.md 
Judge work on three dimensions. 
1. Assess for correctness. Any correctness issues you report must cite specific requirements violated and steps to reproduce. 
2. Look for common errors or anti patterns.
3. Nothing is security critical, so doesn't need nitpicking; look only for glaring security flaws.
Save your findings to `.agent-work/phase-05/audit.md`
```

Finally, use spawn_subsession and yield_to_subsession fix the issues in `.agent-work/phase-05/audit.md`.

Important: all subsessions must be sequential. Never start more than one.
