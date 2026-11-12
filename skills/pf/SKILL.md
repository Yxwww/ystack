---
name: pf
description: "Answers questions about what is listening on this machine: whether a dev server is already running on this repo, what is on a given port, whether a port is free, and which repo owns a swarm of listeners. Use before starting a dev server, before picking a port, on EADDRINUSE, or when the user asks 'is something already running?', 'what's on 5173?', 'is 3000 free?', 'stop the server I started', or mentions pf directly."
---

# pf — what is listening, and on whose behalf

`pf` reports every listening TCP port on this machine, tagged with the owning
process, the script it runs, and — via `gitRoot` — which repo it belongs to. It
is on `PATH` at `~/.local/bin/pf`.

Answer with a command, not by reading a wall of output. The questions below are
what an agent is actually asked; run the matching command.

| Question | Command |
|---|---|
| Is this repo already serving something? | `pf json --compact` + the `gitRoot` filter (below) |
| What is on port 5173? | `pf find 5173` — or the JSON filter for a scriptable answer |
| Is port 3000 free? | `pf json --compact` + port filter (**not** `pf find`; see the trap) |
| Which repo owns all these ports? | `pf json --compact` grouped by `gitRoot` |
| Stop the server I started | `pf kill <port\|pid>` — after confirming it is yours |
| Open it in the browser | `pf open 5173` |

## Is this repo already serving something?

`gitRoot` is the field that answers this. Do **not** compare `cwd` — for a
monorepo it is the leaf package (`app-framework`, `sdks/my-sdk`), so it will not
equal the repo root. Anchor on git's own toplevel so the query works from any
subdirectory:

```bash
pf json --compact | node -e '
const{execSync}=require("child_process");let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
  let root;try{root=execSync("git rev-parse --show-toplevel",
    {encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim()}
  catch{return console.log("not a git repo")}
  const hit=JSON.parse(s).filter(p=>p.gitRoot &&
    (p.gitRoot===root||p.gitRoot.startsWith(root+"/")));
  if(!hit.length)return console.log("nothing serving under "+root);
  for(const p of hit)console.log(p.port+"\t"+p.script+"\tpid "+p.pid);
})'
```

The prefix match matters: in a monorepo `gitRoot` can be a *nested* root
(`.../pr-222/sdk`), so an equality test alone reports "nothing" while three
servers are up.

## What is on port N, and is N free?

```bash
pf json --compact | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const p=Number(process.argv[1]),hit=JSON.parse(s).filter(r=>r.port===p);
  if(!hit.length)return console.log(p+" free");
  for(const h of hit)console.log(p+" IN USE pid "+h.pid+" "+h.script+" addr "+h.address);
})' 5173
```

**Trap: `pf find` is not a port-in-use test.** A single token happens to work,
but `pf find 3000 || echo free` is the wrong habit, because:

- `pf find` with **no query at all** exits **`1`** (bare usage error), and
- only the **first** positional argument is read — extra words are silently
  ignored, so `pf find 3000 free` is exactly `pf find 3000`; it does *not*
narrow the search.

Decide from the JSON port filter above, not from an exit code.

`pf find <query>` is still the right tool for a human-readable lookup by port,
name, project, or command — just read its output, don't branch on its status.

## Reading `address`

| `address` | Meaning |
|---|---|
| `*` or `0.0.0.0` | bound to all interfaces — reachable from the network, and the one that actually causes `EADDRINUSE` |
| `127.0.0.1` / `[::1]` | loopback only — safe for local dev, invisible to the network |

A port can be busy on loopback and free on all interfaces, and `pf` lists those
as separate rows. Check the `address` before declaring a port taken.

## Killing safely

```bash
pf kill 5173        # by port
pf kill <pid>       # by pid
```

Both print `killed <pid> (<name>) on port <n>`. Prefer killing by port.

**Confirm before killing.** A listener on the port you want is often another
repo's dev server, a colleague's workspace, or something the user is actively
using. The user said "free up 4447", not "kill whatever is on 4447" — if
`gitRoot` belongs to a different repo than the one you are working in, say so
and ask first. Killing it silently destroys state they cannot recover.

## Reference

```text
pf                Interactive TUI (j/k move, d kill, r refresh, q quit)
pf list           Plain table, pipe-friendly
pf json           JSON array (--compact for one line)
pf find <query>   Search by port, name, project, or command
pf kill <target>  Kill by port, pid, name, or project
pf open <target>  Open http://localhost:<port>
pf --snapshot     Colored snapshot of the table
```

One JSON record per listener:

| Field | Example | Notes |
|---|---|---|
| `port` | `5173` | the listening port |
| `pid` | `80689` | process id |
| `command` | `node` | process name only |
| `fullCommand` | `node ~/proj/node_modules/.bin/vite dev` | full argv |
| `script` | `../vite/bin/vite.js` | script path as run |
| `project` | `my-app` | package name; empty string `""` when unknown (`—` is text-output only) |
| `user` | `alice` | OS user owning the process |
| `address` | `*` / `[::1]` | see the table above |
| `protocol` | `IPv4` / `IPv6` | |
| `fd` | `14u` | file descriptor |
| `cwd` | `~/proj/my-app/app` | process working directory |
| `gitRoot` | `~/proj/my-app` | nearest enclosing git root — **use this for "which repo"** |

Exit codes: `find` and `kill` return `1` on no match, and `kill` also returns `1`
when called with no argument (after printing its usage). So `pf kill` failing is
indistinguishable from `pf kill` being misused — read the output, not just the
status. Note that piping these (`pf find x | head`) reports `head`'s exit code,
not `pf`'s, which makes a missing match look like a success.
