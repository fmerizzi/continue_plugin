# continue

Auto-continues an [opencode](https://opencode.ai) agent until it declares the job done.

Point a long-running task at a scoped agent, and `continue` keeps nudging it forward — one "continue where you left off" prompt at a time — until the agent ends its reply with the exact line `JOB COMPLETED`.

## How it works

```
session.idle ──► is this the solver agent? ──► did the last reply end with JOB COMPLETED?
                     │ no → ignore                       │ yes → reset, stop
                     └──► send "Continue where you left off…"
```

1. **Watches `session.idle`** — when a session goes quiet, the plugin checks the last assistant reply.
2. **Scoped to one agent** — by default only the `solver` agent is driven; every other session is ignored.
3. **Marker detection** — the run ends only when `JOB COMPLETED` is the *last non-empty line* of the reply, so the model can't trip it by mentioning the phrase mid-sentence.
4. **Bounded** — a hard cap of 25 continuations, a 2s cooldown between prompts, and no stacking while a prompt is in flight.

## Safety gates

| Gate | What it does |
| --- | --- |
| `MAX = 25` | Hard stop after 25 continuations per session |
| `COOLDOWN_MS = 2000` | Pause between the idle event and the next prompt |
| `running` flag | Never stacks a prompt on top of an in-flight one |
| `seen` set | De-duplicates the same assistant turn |
| Error check | Never re-prompts after an errored or aborted turn |
| Agent gate | Only drives the configured agent — your other sessions are untouched |

The plugin is deliberately **model-agnostic**: it never touches the model field, so you can switch models mid-session (Ctrl+P) without breaking the loop.

## Install

1. Copy `plugin/continue.ts` into your opencode project:

   ```sh
   mkdir -p .opencode/plugin
   cp plugin/continue.ts .opencode/plugin/
   ```

2. Add the agent to your `opencode.json` (see [`plugin/agent.txt`](plugin/agent.txt)):

   ```json
   {
     "agent": {
       "solver": {
         "name": "solver",
         "description": "Autonomous problem solver for long-running open-ended tasks",
         "model": "llama-local/qwen3.8-27b",
         "mode": "primary",
         "color": "#3fb950",
         "steps": 400,
         "prompt": "You are a research engineer, work the task step by step and do not stop to ask questions. Decide and proceed.",
         "temperature": 0.3,
         "permission": {
           "*": "allow",
           "doom_loop": "ask"
         }
       }
     }
   }
   ```

3. Start a session with the `solver` agent and give it your task. It will keep going until it finishes or hits the cap.

## Configuration

All knobs are constants at the top of `plugin/continue.ts`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `SCOPED_AGENT` | `"solver"` | The only agent the plugin will drive |
| `MAX` | `25` | Max continuations per session before a hard stop |
| `COOLDOWN_MS` | `2000` | Delay before each continuation prompt |
| `MARKER` | `"JOB COMPLETED"` | The exact line that ends the loop |

## FAQ

**Why is the marker checked as the last line?**
So the model can't accidentally end the run by mentioning `JOB COMPLETED` in passing — it has to *commit* to it as the final line of the reply.

**Can I switch models mid-session?**
Yes. The plugin only pins the agent, never the model.

**What happens when the cap is hit?**
The plugin stops prompting and the session simply goes idle. The counter resets the next time the agent finishes a job.

**Does it interfere with my other sessions?**
No. Anything that isn't running under the scoped agent is ignored entirely.

## Docs

- [docs/how-it-works.md](docs/how-it-works.md) — deeper dive into the event flow and design decisions

## License

[MIT](LICENSE)
