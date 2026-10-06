import type { Plugin } from "@opencode-ai/plugin"

const MARKER = "JOB COMPLETED"
const MAX = 25
const COOLDOWN_MS = 2000

/** Only drive this agent. */
const SCOPED_AGENT = "solver"

/**
 * True when the marker is the LAST non-empty line — so the model can't
 * trip it by mentioning the phrase mid-sentence.
 */
export function isDone(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length > 0 && lines[lines.length - 1] === MARKER
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CONTINUE_PROMPT =
  `Continue where you left off. When the whole job is finished, ` +
  `end your reply with the exact line: ${MARKER}`

export const HelloPlugin: Plugin = async ({ client }) => {
  // Per-session state. Model-agnostic: no model fields, so Ctrl+P works freely.
  const sessions = new Map<
    string,
    { iterations: number; running: boolean; seen: Set<string>; agent?: string }
  >()
  const state = (id: string) => {
    let s = sessions.get(id)
    if (!s) {
      s = { iterations: 0, running: false, seen: new Set(), agent: undefined }
      sessions.set(id, s)
    }
    return s
  }

  return {
    // Learn which agent the session is on. Model is deliberately left alone.
    "chat.params": async (input) => {
      const s = state(input.sessionID)
      s.agent = input.agent
      if (input.agent === SCOPED_AGENT) {
        console.log(`[solver] session ${input.sessionID.slice(0, 8)} agent = ${input.agent}`)
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        sessions.delete((event as any).properties?.info?.id)
        return
      }
      if (event.type !== "session.idle") return

      const sessionID = (event as any).properties.sessionID
      const s = state(sessionID)

      // Gate: only ever continue inside the solver.
      if (s.agent !== SCOPED_AGENT) return

      if (s.running) return               // don't stack prompts
      if (s.iterations >= MAX) return     // hard stop

      const { data: messages } = await client.session.messages({ path: { id: sessionID } })
      if (!messages?.length) return       // fetch failed or empty → nothing to do

      const last = [...messages].reverse().find((m) => m.info.role === "assistant")
      if (!last) return

      // Narrow the Message union so .error / .id are legal on the assistant branch.
      const info = last.info
      if (info.role !== "assistant") return   // runtime no-op; satisfies the compiler

      if (info.error) return              // never fight an error/abort

      if (s.seen.has(info.id)) return     // de-dup the same turn
      s.seen.add(info.id)

      // Narrow each Part to the text branch as we read it — no casts needed.
      let text = ""
      for (const p of last.parts) {
        if (p.type === "text") text += (text ? "\n" : "") + p.text
      }

      if (isDone(text)) {
        console.log(`[solver] done after ${s.iterations} continuation(s)`)
        s.iterations = 0
        return
      }

      s.running = true
      try {
        s.iterations += 1
        console.log(`[solver] continuation ${s.iterations}/${MAX}`)
        await sleep(COOLDOWN_MS)
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            agent: s.agent,   // stay in solver; model is inherited from the session
            parts: [{ type: "text", text: CONTINUE_PROMPT }],
          },
        })
      } finally {
        s.running = false
      }
    },
  }
}
