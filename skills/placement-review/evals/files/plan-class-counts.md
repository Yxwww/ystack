# Plan: show user/system/root process counts in pf

Repo: apps/ports (Bun + TypeScript)

1. New `src/stats.ts` with `countByClass(entries): { user: number; system: number; root: number }` — loops over entries and calls `classifyProcess` on each.
2. TUI (`src/tui.ts` `refresh()`): after computing `cwdCount`, call `countByClass(entries)` and append "· 4 user / 2 sys / 1 root" to the title.
3. Snapshot (`src/snapshot.ts`): after the row loop, call `countByClass(entries)` and add the same breakdown to the summary line.
4. Tests: new `src/stats.test.ts` with three tests: all-user entries, mixed entries, empty list.
