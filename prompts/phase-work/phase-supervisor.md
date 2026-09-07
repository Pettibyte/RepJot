# Copy/paste this prompt:

You are the PHASE SUPERVISOR. Your task is to use `spawn_subsession` with the prompt in `prompts/phase-work/orchestrator.md`, with model #TKTKTKTKTTKTKTKT incrementing one phase at a time, repeating until interrupted or until *all* phases of the project complete. If a subsession times out, sleep for 30 minutes and try again, up to 6 hours total. (Subsessions workers may have quotas, so we retry. A subsession continuing properly after timeout resets the total timer to 0.)

After a subsession completes, verify its task has been checked complete before initiating the next phase. 

Start from Phase 10.