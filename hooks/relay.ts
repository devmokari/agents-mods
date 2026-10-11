// Agents at work through Claude: handovers and briefings, steps and reports, teammate requests, activity.
import type { Ask, Asks, Roster, Run } from '../types'
import { AGENT_PREFIX, clock, dayLabel, handleOf } from './model'

// Talking to agents through Claude: what Claude is told to do with a message for a panel agent.

// `inbox`: the person wrote from the Agents inbox, which shows the answer itself, so Claude only confirms.
export const handover = (roster: Roster, agentId: string, isRunning: boolean, text: string, relay: 'full' | 'inbox' = 'full'): string => {
  const agent = roster.agents.find(one => one.id === agentId)
  if (agent === undefined) return ''
  const handle = handleOf(agent.name)
  const back =
    relay === 'inbox'
      ? `Do not answer it yourself. When ${agent.name} reports back, reply with one line only: "${agent.name} answered in the Agents inbox." Do not repeat or summarise its answer.`
      : `Do not answer it yourself. When ${agent.name} reports back, give me its answer in full.`
  if (isRunning) {
    return [
      `Agent mode: pass this message to my teammate ${agent.name}, who is running. Call SendMessage with to "${handle}" and the message below, word for word.`,
      back,
      '',
      text,
    ].join('\n')
  }

  // The briefing (role, teammates, chat so far, the message; `intro`) waits for the agent's get_briefing call,
  // so the handover Claude's chat shows stays a few lines.
  return [
    `Agent mode: start my teammate ${agent.name}. Call the Agent tool once with name "${handle}", description "${AGENT_PREFIX}${agent.name}", subagent_type "general-purpose", model "${agent.model}", run_in_background true, and exactly the prompt below.`,
    back,
    '',
    `You are ${agent.name}, ${agent.title} in the ${agent.team} team of Agent mode. Before anything else, call get_briefing (${BRIEF_TOOL}) and do what it says. If you cannot call it, say so and stop.`,
  ].join('\n')
}

export const BRIEF_TOOL = 'mcp__agents__get_briefing'
export const BRIEF_SCHEMA = { type: 'object', properties: {}, additionalProperties: false } as const

const short = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text)
const base = (path: unknown): string => (typeof path === 'string' ? path.split(/[\\/]/).pop() ?? path : '')

// One line per tool call, as the card in Claude's reply lists the agent's steps.
export const stepText = (tool: string, input: Record<string, unknown>): string => {
  switch (tool) {
    case 'Read':
      return `Reading ${base(input.file_path)}`
    case 'Write':
      return `Writing ${base(input.file_path)}`
    case 'Edit':
      return `Editing ${base(input.file_path)}`
    case 'Bash':
      return `Running ${short(String(input.command ?? ''), 48)}`
    case 'Grep':
    case 'Glob':
      return `Searching files for ${short(String(input.pattern ?? ''), 40)}`
    case 'WebSearch':
      return `Searching the web for "${short(String(input.query ?? ''), 48)}"`
    case 'WebFetch':
      return `Reading ${short(String(input.url ?? '').replace(/^https?:\/\//, ''), 48)}`
    case 'mcp__agents__message_teammate':
      return `Messaging ${String(input.to ?? 'a teammate')}`
    case 'mcp__agents__update_my_profile':
      return 'Updating its profile'
    default:
      return `Using ${tool.replace(/^mcp__[^_]+__/, '')}`
  }
}

export const STEP_LIMIT = 12
export const RUN_LIMIT = 40

export const addStep = (history: Record<string, Run>, loop: string, text: string, at: number): Record<string, Run> => {
  const run = history[loop]
  if (run === undefined) return history

  return { ...history, [loop]: { ...run, steps: [...run.steps, { at, text }].slice(-STEP_LIMIT) } }
}

export const startRun = (history: Record<string, Run>, loop: string, panelId: string, at: number): Record<string, Run> => {
  const kept = Object.entries(history)
    .sort(([, a], [, b]) => a.startedAt - b.startedAt)
    .slice(-(RUN_LIMIT - 1))

  return { ...Object.fromEntries(kept), [loop]: { panelId, startedAt: at, steps: [] } }
}

export const endRun = (history: Record<string, Run>, loop: string, answer: string, at: number): Record<string, Run> => {
  const run = history[loop]

  return run === undefined ? history : { ...history, [loop]: { ...run, endedAt: at, answer } }
}

// The report card under a finished run: a title from the answer's first line, and its size.
export const reportOf = (answer: string): { title: string; words: number; lines: number } => {
  const lines = answer.split('\n').filter(line => line.trim() !== '')
  const title = short((lines[0] ?? '').replace(/^\s*(#+|[-*>]|\d+\.)\s*/, '').replace(/[*_`]/g, '').trim() || 'Report', 72)

  return { title, words: answer.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length, lines: lines.length }
}

// Where "Save .md" writes a run's answer: the session's folder, agent-reports/<agent>-<UTC stamp>.md.
export const reportPath = (cwd: string, name: string, at: number): string =>
  `${cwd.replace(/[\\/]+$/, '')}/agent-reports/${handleOf(name)}-${new Date(at).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}.md`

// The agent a handover names: what the Agents inbox shows in place of the long handover row in the main chat.
// The host stores a plugin's prompt behind its own frame ("The agent-mode plugin sent a message:"), so that frame may lead.
export const handoverTarget = (text: string): string | undefined =>
  /^(?:The (?:agents|agent-mode) plugin sent a message:\s*)?Agent mode: (?:start my teammate (.+?)\. Call|pass this message to my teammate (.+?), who is running)/
    .exec(text.trimStart())
    ?.slice(1)
    .find(Boolean)

// What a chat line shows: pasted-content wrappers dropped, the words kept.
export const shown = (text: string): string => text.replace(/<\/?pasted_content[^>]*>/g, '').trim()

// When a line was written: the time today, else the day and time.
export const stamp = (at: number, now: number): string => {
  const day = dayLabel(at, now)

  return day === 'Today' ? clock(at) : `${day} ${clock(at)}`
}

// Teammate requests, per teammate asked, oldest first. One is out at a time: it is delivered when the teammate is free,
// tied to the loop it reached, and only that loop's next answer goes back to its sender; the next request goes out then.
export const askQueue = (asks: Asks, targetId: string): Ask[] => {
  const queue = asks[targetId]

  return Array.isArray(queue) ? queue : []
}

export const enqueueAsk = (asks: Asks, targetId: string, ask: Ask): Asks => ({ ...asks, [targetId]: [...askQueue(asks, targetId), ask] })

// The request to send now: the head of the queue, when nothing is out yet and the teammate is free.
export const askToDeliver = (asks: Asks, targetId: string, isTargetFree: boolean): Ask | undefined => {
  const head = askQueue(asks, targetId)[0]

  return head !== undefined && !head.isDelivered && head.isSending !== true && isTargetFree ? head : undefined
}

// On its way (in the delivery queue): not sent a second time while it waits there.
export const markAskSending = (asks: Asks, targetId: string, askId: string): Asks => ({
  ...asks,
  [targetId]: askQueue(asks, targetId).map(ask => (ask.id === askId ? { ...ask, isSending: true } : ask)),
})

// Delivered: into a running loop (`loop`), or handed to Claude to start one (bound at its start by `bindAskLoop`).
export const markAskDelivered = (asks: Asks, targetId: string, askId: string, loop?: string): Asks => ({
  ...asks,
  [targetId]: askQueue(asks, targetId).map(ask => (ask.id === askId ? { id: ask.id, from: ask.from, fromName: ask.fromName, text: ask.text, isDelivered: true, ...(loop === undefined ? {} : { loop }) } : ask)),
})

export const bindAskLoop = (asks: Asks, targetId: string, loop: string): Asks => {
  const queue = askQueue(asks, targetId)
  const head = queue[0]
  if (head === undefined || !head.isDelivered || head.loop !== undefined) return asks

  return { ...asks, [targetId]: [{ ...head, loop }, ...queue.slice(1)] }
}

// A teammate's loop finished a turn: the request it answers (only the delivered head tied to that loop), and the
// request to send next. An answer from any other loop, or before delivery, answers nobody.
export const answerAsk = (asks: Asks, targetId: string, loop: string): { asks: Asks; answered?: Ask; next?: Ask } => {
  const queue = askQueue(asks, targetId)
  const head = queue[0]
  if (head === undefined) return { asks }
  if (head.isDelivered && head.loop === loop) {
    const rest = queue.slice(1)
    const left = { ...asks }
    if (rest.length === 0) delete left[targetId]
    else left[targetId] = rest

    const next = rest[0]

    return { asks: left, answered: head, next: next !== undefined && !next.isDelivered && next.isSending !== true ? next : undefined }
  }

  return { asks, next: head.isDelivered || head.isSending === true ? undefined : head }
}

// A request that cannot go out (its teammate was deleted): off the queue, so it holds up nothing behind it.
export const dropAsk = (asks: Asks, targetId: string, askId: string): Asks => {
  const rest = askQueue(asks, targetId).filter(ask => ask.id !== askId)
  const left = { ...asks }
  if (rest.length === 0) delete left[targetId]
  else left[targetId] = rest

  return left
}

// After a send: taken, the agent's draft empties only if it still holds the words sent (typing since is kept);
// refused, the draft is left as it is.
export const draftAfterSend = (drafts: Record<string, string>, agentId: string, sent: string, isSent: boolean): Record<string, string> =>
  isSent && (drafts[agentId] ?? '') === sent ? { ...drafts, [agentId]: '' } : drafts

// What an agent is doing, from real state: working while its own loop runs; waiting while a message to it waits
// for Claude to start it, while requests to it are queued, or while it waits on a teammate's reply; else idle.
export type Activity = { kind: 'working' | 'waiting' | 'idle'; label: string }

export const activityOf = (roster: Roster, runs: Record<string, string>, asks: Asks, agentId: string): Activity => {
  const agent = roster.agents.find(one => one.id === agentId)
  if (agent === undefined) return { kind: 'idle', label: '' }
  const hasLoop = Object.values(runs).includes(agentId)
  if (agent.status !== 'ready' && hasLoop) return { kind: 'working', label: 'Working' }
  if (agent.status !== 'ready') return { kind: 'waiting', label: 'Waiting to start' }
  const head = askQueue(asks, agentId)[0]
  // A teammate's request handed to Claude to start this agent: waiting for that start.
  if (head?.isDelivered === true && head.loop === undefined) return { kind: 'waiting', label: 'Waiting to start' }
  const queued = askQueue(asks, agentId).filter(ask => !ask.isDelivered).length
  if (queued > 0) return { kind: 'waiting', label: queued === 1 ? '1 request queued' : `${queued} requests queued` }
  const awaited = Object.entries(asks).find(([, queue]) => Array.isArray(queue) && queue[0]?.isDelivered === true && queue[0].from === agentId)
  if (awaited !== undefined) {
    const name = roster.agents.find(one => one.id === awaited[0])?.name ?? 'a teammate'
    return { kind: 'waiting', label: `Waiting for ${name}` }
  }

  return { kind: 'idle', label: '' }
}
