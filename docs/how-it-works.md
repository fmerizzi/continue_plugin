# How it works

A deeper look at the internals of the `continue` plugin.

## Event flow

The plugin hooks three opencode events:

```
chat.params ──────► learn which agent the session is on (stored per session)
session.idle ─────► the main loop: maybe send a continuation prompt
session.deleted ──► drop the session's state
```

### `chat.params`

Fires on every prompt. The plugin uses it only to record which agent the session is currently running under:

```ts
"chat.params": async (input) => {
  const s = state(input.sessionID)
  s.agent = input.agent
}
```

The model field is deliberately ignored — that's what keeps model switching (Ctrl+P) safe.

### `session.idle`

The heart of the plugin. When a session goes quiet, the plugin walks a series of gates in order:

1. **Agent gate** — `s.agent !== SCOPED_AGENT` → ignore. Only the configured agent is ever driven.
2. **Stacking gate** — `s.running` → ignore. A continuation is already in flight.
3. **Cap gate** — `s.iterations >= MAX` → ignore. Hard stop.
4. **Fetch** — pull the session's messages from the client API; bail if empty or failed.
5. **Last assistant turn** — find the most recent assistant message.
6. **Error gate** — if that turn errored or was aborted, never re-prompt. Fighting an error just loops it.
7. **De-dup gate** — if this message ID was already handled, ignore. Prevents double-firing on repeated idle events.
8. **Marker check** — if the reply's last non-empty line is `JOB COMPLETED`, log and reset the counter. Done.
9. **Continue** — otherwise, wait `COOLDOWN_MS`, then send the continuation prompt under the same agent.

### `session.deleted`

Drops the session's state so the map doesn't grow unbounded.

## Per-session state

```ts
{
  iterations: number      // continuations sent this run (reset on done)
  running: boolean        // a continuation prompt is in flight
  seen: Set<string>       // assistant message IDs already handled
  agent?: string          // last agent seen via chat.params
}
```

State lives in a `Map<sessionID, …>` inside the plugin closure — no files, no external storage.

## Marker semantics

`isDone()` splits the reply on newlines, trims each line, drops empties, and checks whether the **last** remaining line exactly equals `MARKER`.

```
"…all tests pass.\nJOB COMPLETED"      → done
"…JOB COMPLETED, moving on to tests"   → NOT done
"JOB COMPLETED"                        → done
```

Requiring the marker as the final line means the model has to commit to it — a passing mention mid-sentence can't end the run.

## Why each gate exists

| Gate | Failure mode it prevents |
| --- | --- |
| Agent gate | Driving sessions you didn't intend (e.g. a casual chat) |
| Stacking gate | Two idle events racing → two prompts → context bloat |
| Cap gate | A model that never emits the marker burning tokens forever |
| Error gate | Re-prompting an aborted/errored turn into a loop |
| De-dup gate | The same turn triggering multiple continuations |
| Cooldown | Hammering the API the instant idle fires |

## Extension ideas

- **Custom markers per agent** — make `MARKER` a config option read from `opencode.json`.
- **Per-agent scoping** — drive multiple agents, each with its own cap and marker.
- **Progress logging** — emit a `console.log` per continuation with a short summary of the last turn.
- **Idle timeout** — stop the loop if the session stays idle for N minutes even without the marker.
