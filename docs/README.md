# Docs — what's what

| File | For | Read this when... |
|---|---|---|
| **[CHANGELOG.md](CHANGELOG.md)** | You (the owner) | You want to know what changed and when, in plain language. **Check this one first.** |
| **[project-context.md](project-context.md)** | Anyone (incl. future Claude sessions) | You want to understand how the system is built *today* — architecture, data model, modules. Always describes the current state, not history. |
| **[decisions.md](decisions.md)** | Anyone wanting the "why" | You're wondering why something was built a particular way. Chronological, each entry is a decision + reasoning + impact. |
| **[current-progress.md](current-progress.md)** | Claude, across sessions | Working/technical log used to resume in-progress work with full context after a break. Denser and more technical than the changelog — verification steps, test results, exact file paths. Not meant for a quick read. |
| reconciliation_decisions.md | Historical reference | An early (2026-07-20) decisions log, mostly superseded by `decisions.md` — kept for record, not actively updated. |

## How they get updated

Whenever a feature is completed, three things happen (in this order):
1. **CHANGELOG.md** gets a new dated entry, in plain language, for you.
2. **project-context.md** gets updated if the architecture changed (new
   tables, new modules, new relationships) — so it always reflects *today*,
   not a snapshot from whenever it was last touched.
3. **decisions.md** gets a new entry if a real design choice was made that's
   worth remembering the reasoning for later.

`current-progress.md` is updated continuously during the work itself (it's
the technical scratchpad that lets a session resume mid-task) — it isn't
meant to be a polished read, the changelog is.
