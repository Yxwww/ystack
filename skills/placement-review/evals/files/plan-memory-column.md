# Plan: show memory (RSS) per port in pf

Repo: apps/ports (Bun + TypeScript)

1. Add `rssKb: number` to `PortEntry` in `src/ports.ts`.
2. New `src/memory.ts`:
   - `enrichMemory(entries)`: runs `ps -o pid=,rss= -p <pids>`, parses each line, sets `entry.rssKb`.
   - `formatBytes(kb)`: "512K" / "34.2M" / "1.1G".
3. In `scanPorts()`, call `await enrichMemory(entries)` after the existing enrichment calls.
4. Show a MEM column in all three renderers: `pf list` (`src/index.ts`), the snapshot (`src/snapshot.ts`), and the TUI (`formatOption` in `src/tui.ts`). Each calls `formatBytes`.
5. Tests:
   - New `src/memory.test.ts`: one test per `formatBytes` unit (K, M, G, zero), plus a test for parsing `ps` output.
   - New `src/memory.e2e.test.ts`: start a `Bun.serve` on a random port, run `bun src/index.ts json`, assert the entry for that port has `rssKb > 0`.
