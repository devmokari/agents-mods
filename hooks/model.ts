import type { Agent, Line, Roster, Status, Usage } from '../types'
import { FACES } from './faces'

export const HISTORY_LIMIT = 300
export const DEFAULT_TEAM = 'Uncategorised'
export const DEFAULT_MODEL = 'sonnet'
export const MODELS = ['sonnet', 'opus', 'haiku', 'fable'] as const
export const AGENT_PREFIX = 'Team member: '

export const emptyRoster = (): Roster => ({ agents: [], teams: [DEFAULT_TEAM], chats: {}, nextNumber: 1 })

export const isRoster = (value: unknown): value is Roster =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Roster).agents) &&
  Array.isArray((value as Roster).teams) &&
  typeof (value as Roster).chats === 'object' &&
  typeof (value as Roster).nextNumber === 'number'

export const appendLine = (roster: Roster, agentId: string, line: Line): Roster => ({
  ...roster,
  chats: { ...roster.chats, [agentId]: [...(roster.chats[agentId] ?? []), line].slice(-HISTORY_LIMIT) },
})

export const addAgent = (roster: Roster, team: string, now: number): Roster => {
  const number = roster.nextNumber
  const id = `agent-${now.toString(36)}-${number}`
  const agent: Agent = {
    id,
    name: `Agent ${number}`,
    title: 'Generalist',
    team,
    model: DEFAULT_MODEL,
    face: (number - 1) % FACES.length,
    status: 'ready',
    isPinned: false,
    isUnread: false,
    unread: 0,
    abilities: [],
    attributes: [],
    usage: { replies: 0, tools: 0, tokensIn: 0, tokensOut: 0 },
  }
  const greeting: Line = {
    id: `${id}-hello`,
    from: 'agent',
    text: `Hi, I'm ${agent.name}. Tell me what you need and I'll get started.`,
    at: now,
  }
  const teams = roster.teams.includes(team) ? roster.teams : [...roster.teams, team]

  return appendLine({ ...roster, agents: [...roster.agents, agent], teams, nextNumber: number + 1 }, id, greeting)
}

export const addTeam = (roster: Roster, name: string): Roster => {
  const team = name.trim()

  return team === '' || roster.teams.includes(team) ? roster : { ...roster, teams: [...roster.teams, team] }
}

// Rosters saved before 0.1.21 called the default team "Team".
export const renameLegacyTeam = (roster: Roster): Roster =>
  !roster.teams.includes('Team') || roster.teams.includes(DEFAULT_TEAM)
    ? roster
    : {
        ...roster,
        teams: roster.teams.map(team => (team === 'Team' ? DEFAULT_TEAM : team)),
        agents: roster.agents.map(agent => (agent.team === 'Team' ? { ...agent, team: DEFAULT_TEAM } : agent)),
      }

export const removeTeam = (roster: Roster, team: string): Roster =>
  roster.agents.some(agent => agent.team === team) ? roster : { ...roster, teams: roster.teams.filter(one => one !== team) }

export const markRead = (roster: Roster, agentId: string): Roster => ({
  ...roster,
  agents: roster.agents.map(agent => (agent.id === agentId ? { ...agent, isUnread: false, unread: 0 } : agent)),
})

// Replies not yet seen in the open chat; a roster saved before counts existed reads its flag as one.
export const unreadOf = (agent: Agent): number => agent.unread ?? (agent.isUnread ? 1 : 0)

export const preview = (roster: Roster, agentId: string): string => {
  const lines = roster.chats[agentId] ?? []
  const last = [...lines].reverse().find(line => line.from !== 'note')
  if (last === undefined) return ''

  return last.text.replace(/\s+/g, ' ').trim()
}

// The list's last message: at most 20 characters, then a literal "..." when there was more. Counted in code points,
// so an emoji is never cut in half.
export const PREVIEW_MAX = 20
export const shortPreview = (text: string): string => {
  const chars = Array.from(text)
  return chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX).join('').trimEnd()}...` : text
}

export type Section = { title: string; team?: string; agents: Agent[] }

export const sections = (roster: Roster): Section[] => {
  const pinned = roster.agents.filter(agent => agent.isPinned)
  const byTeam = roster.teams.map(team => ({
    title: team,
    team,
    agents: roster.agents.filter(agent => agent.team === team && !agent.isPinned),
  }))

  return pinned.length > 0 ? [{ title: 'Pinned', agents: pinned }, ...byTeam] : byTeam
}

// Chat layout: what the card shows for a window of rows.

export type Row =
  | { kind: 'day'; key: string; text: string }
  | { kind: 'note'; key: string; text: string }
  | { kind: 'bubble'; key: string; line: Line; isTight: boolean }

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const startOfDay = (at: number): number => {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)

  return day.getTime()
}

export const dayLabel = (at: number, now: number): string => {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const date = new Date(at)
  if (days < 7) return WEEKDAYS[date.getDay()] ?? ''

  return date.toISOString().slice(0, 10)
}

export const clock = (at: number): string => {
  const date = new Date(at)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const toRows = (lines: readonly Line[], now: number): Row[] => {
  const rows: Row[] = []
  let day = ''
  let speaker = ''
  for (const line of lines) {
    const label = dayLabel(line.at, now)
    if (label !== day) {
      rows.push({ kind: 'day', key: `day-${line.id}`, text: label })
      day = label
      speaker = ''
    }
    if (line.from === 'note') {
      rows.push({ kind: 'note', key: line.id, text: line.text })
      speaker = ''
      continue
    }
    rows.push({ kind: 'bubble', key: line.id, line, isTight: speaker === line.from })
    speaker = line.from
  }

  return rows
}

// Agent lifecycle: pure changes the hooks apply.

export const handleOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'

const changeAgent = (roster: Roster, agentId: string, change: (agent: Agent) => Agent): Roster => ({
  ...roster,
  agents: roster.agents.map(agent => (agent.id === agentId ? change(agent) : agent)),
})

export const setStatus = (roster: Roster, agentId: string, status: Status): Roster =>
  changeAgent(roster, agentId, agent => ({ ...agent, status }))

export const addUsage = (roster: Roster, agentId: string, delta: Partial<Usage>): Roster =>
  changeAgent(roster, agentId, agent => ({
    ...agent,
    usage: {
      replies: agent.usage.replies + (delta.replies ?? 0),
      tools: agent.usage.tools + (delta.tools ?? 0),
      tokensIn: agent.usage.tokensIn + (delta.tokensIn ?? 0),
      tokensOut: agent.usage.tokensOut + (delta.tokensOut ?? 0),
    },
  }))

export const sendLine = (roster: Roster, agentId: string, text: string, now: number): Roster =>
  setStatus(appendLine(roster, agentId, { id: `${agentId}-${now.toString(36)}-you`, from: 'you', text, at: now }), agentId, 'thinking')

export const noteLine = (roster: Roster, agentId: string, text: string, now: number): Roster =>
  appendLine(roster, agentId, { id: `${agentId}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, from: 'note', text, at: now })

export const replyLine = (roster: Roster, agentId: string, text: string, now: number, isSeen: boolean): Roster => {
  const answered = {
    ...roster,
    chats: { ...roster.chats, [agentId]: (roster.chats[agentId] ?? []).map(line => (line.from === 'you' ? { ...line, isAnswered: true } : line)) },
  }
  const replied = appendLine(answered, agentId, { id: `${agentId}-${now.toString(36)}-reply`, from: 'agent', text, at: now })

  return changeAgent(replied, agentId, agent => ({ ...agent, status: 'ready', isUnread: agent.isUnread || !isSeen, unread: isSeen ? unreadOf(agent) : unreadOf(agent) + 1 }))
}

// What a starting subagent is told: who it is, its teammates, abilities, attributes and the chat so far.
export type Incoming = { from: string; text: string; isReply: boolean }

export const intro = (roster: Roster, agentId: string, incoming?: Incoming): string => {
  const agent = roster.agents.find(one => one.id === agentId)
  if (agent === undefined) return ''
  const mates = roster.agents
    .filter(one => one.id !== agentId)
    .map(one => `- ${one.name} (${one.title}, ${one.team} team)`)
  const lines = roster.chats[agentId] ?? []
  const history = lines
    .filter(line => line.from !== 'note')
    .map(line => `${line.from === 'you' ? 'Person' : agent.name}: ${line.text}`)
  const latest = [...lines].reverse().find(line => line.from === 'you')

  return [
    `You are ${agent.name}, ${agent.title} in the ${agent.team} team of Agent mode, a team of named agents the person talks to through Claude in the main chat.`,
    `Your final answer goes back to Claude, who gives it to the person in full, so write it to the person directly.`,
    `Abilities: ${agent.abilities.length > 0 ? agent.abilities.join(', ') : 'none set'}.`,
    `Attributes: ${agent.attributes.length > 0 ? agent.attributes.join(', ') : 'none set'}.`,
    `When the person asks you to change your name, title, team, model, abilities or attributes, call the update_my_profile tool (mcp__agent-mode__update_my_profile).`,
    mates.length > 0
      ? `Your teammates, to split work with by name. Message one with the message_teammate tool (mcp__agent-mode__message_teammate, \`to\` = their name); a stopped teammate is started for it, and their final answer comes back to you as a message. Never message a teammate just to answer them; your final answer reaches them on its own:\n${mates.join('\n')}`
      : 'You have no teammates yet.',
    (incoming === undefined ? history.length > 1 : history.length > 0)
      ? `The chat so far:\n${(incoming === undefined ? history.slice(0, -1) : history).join('\n')}`
      : '',
    incoming === undefined
      ? `The person's message to answer now:\n${latest?.text ?? ''}`
      : incoming.isReply
        ? `Your teammate ${incoming.from} replied to your message. Carry on with the work using it:\n${incoming.text}`
        : `A message from your teammate ${incoming.from} to act on now. Your final answer goes back to ${incoming.from} on its own; do not message ${incoming.from} to answer it:\n${incoming.text}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export type ProfileChange = {
  name?: string
  title?: string
  team?: string
  model?: string
  abilities?: string[]
  attributes?: string[]
}

export type ProfileResult = { roster: Roster; notes: string[]; error?: string; isModelChanged: boolean }

const asList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : undefined

const asText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

// A name given as a string is kept even when blank, so a blank rename is refused rather than ignored.
export const readProfileChange = (input: Record<string, unknown>): ProfileChange => ({
  name: typeof input.name === 'string' ? input.name.trim() : undefined,
  title: asText(input.title),
  team: asText(input.team),
  model: asText(input.model),
  abilities: asList(input.abilities),
  attributes: asList(input.attributes),
})

export const applyProfile = (roster: Roster, agentId: string, requested: ProfileChange): ProfileResult => {
  let change = requested
  const agent = roster.agents.find(one => one.id === agentId)
  if (agent === undefined) return { roster, notes: [], error: 'No such agent.', isModelChanged: false }
  if (change.model !== undefined && !(MODELS as readonly string[]).includes(change.model)) {
    return { roster, notes: [], error: `Unknown model "${change.model}". Use one of: ${MODELS.join(', ')}.`, isModelChanged: false }
  }
  if (change.name !== undefined) {
    const name = change.name.trim()
    if (name === '') return { roster, notes: [], error: 'A name cannot be empty.', isModelChanged: false }
    // Names route messages by their handle (`agent-1`), so two agents may not share one.
    const clash = roster.agents.find(one => one.id !== agentId && handleOf(one.name) === handleOf(name))
    if (clash !== undefined) return { roster, notes: [], error: `There is already a team member called ${clash.name}.`, isModelChanged: false }
    change = { ...change, name }
  }
  const notes: string[] = []
  const next: Agent = { ...agent }
  if (change.name !== undefined && change.name !== agent.name) {
    notes.push(`${agent.name} is now called ${change.name}`)
    next.name = change.name
  }
  if (change.title !== undefined && change.title !== agent.title) {
    notes.push(`${next.name}'s title is now ${change.title}`)
    next.title = change.title
  }
  if (change.team !== undefined && change.team !== agent.team) {
    notes.push(`${next.name} moved to ${change.team}`)
    next.team = change.team
  }
  if (change.model !== undefined && change.model !== agent.model) {
    notes.push(`${next.name} now runs on ${change.model}`)
    next.model = change.model
  }
  if (change.abilities !== undefined) {
    notes.push(`${next.name}'s abilities: ${change.abilities.join(', ') || 'none'}`)
    next.abilities = change.abilities
  }
  if (change.attributes !== undefined) {
    notes.push(`${next.name}'s attributes: ${change.attributes.join(', ') || 'none'}`)
    next.attributes = change.attributes
  }
  const teams = roster.teams.includes(next.team) ? roster.teams : [...roster.teams, next.team]
  const changed = { ...roster, teams, agents: roster.agents.map(one => (one.id === agentId ? next : one)) }

  return { roster: changed, notes, isModelChanged: next.model !== agent.model }
}

export const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Your new display name.' },
    title: { type: 'string', description: 'Your new job title.' },
    team: { type: 'string', description: 'The team to move to; created when new.' },
    model: { type: 'string', enum: [...MODELS], description: 'The model to run on from your next message.' },
    abilities: { type: 'array', items: { type: 'string' }, description: 'Your full list of abilities, replacing the old one.' },
    attributes: { type: 'array', items: { type: 'string' }, description: 'Your full list of attributes, replacing the old one.' },
  },
  additionalProperties: false,
}

// Which panel agent a subagent loop belongs to, from the description it was started with.
export const panelFor = (roster: Roster, description: string): string | undefined => {
  if (!description.startsWith(AGENT_PREFIX)) return undefined
  const name = description.slice(AGENT_PREFIX.length).trim()

  return roster.agents.find(agent => agent.name === name || handleOf(agent.name) === handleOf(name))?.id
}

const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export const liveLoopFor = (
  agents: readonly { id: string; description: string; status: string }[],
  roster: Roster,
  agentId: string,
): string | undefined => [...agents].reverse().find(info => LIVE.has(info.status) && panelFor(roster, info.description) === agentId)?.id

export const MESSAGE_SCHEMA = {
  type: 'object',
  properties: {
    to: { type: 'string', description: "The teammate's name, as your intro lists it." },
    message: { type: 'string', description: 'What to tell or ask them.' },
  },
  required: ['to', 'message'],
  additionalProperties: false,
}

export const findTeammate = (roster: Roster, fromId: string, to: string): Agent | undefined =>
  roster.agents.find(agent => agent.id !== fromId && (agent.name.toLowerCase() === to.trim().toLowerCase() || handleOf(agent.name) === handleOf(to)))

export const teammateText = (from: string, text: string, isReply: boolean): string =>
  isReply ? `Reply from your teammate ${from}:\n${text}` : `Message from your teammate ${from} (your final answer goes back to ${from} on its own; do not message ${from} to answer it):\n${text}`

export const ADD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: "The new team member's name." },
    title: { type: 'string', description: 'Their job title.' },
    team: { type: 'string', description: 'The team to put them in; created when new.' },
    model: { type: 'string', enum: [...MODELS], description: 'The model they run on.' },
    abilities: { type: 'array', items: { type: 'string' } },
    attributes: { type: 'array', items: { type: 'string' } },
  },
  required: ['name'],
  additionalProperties: false,
}

// Adds a named member: a new agent in the team, then the profile the request gives it.
export const addMember = (roster: Roster, input: Record<string, unknown>, now: number): ProfileResult & { agentId?: string } => {
  const change = readProfileChange(input)
  if (change.name === undefined || change.name === '') return { roster, notes: [], error: 'A name is required.', isModelChanged: false }
  const taken = roster.agents.some(agent => handleOf(agent.name) === handleOf(change.name ?? ''))
  if (taken) return { roster, notes: [], error: `There is already a team member called ${change.name}.`, isModelChanged: false }
  const team = change.team ?? roster.teams[0] ?? DEFAULT_TEAM
  const added = addAgent(roster, team, now)
  const agent = added.agents[added.agents.length - 1]
  if (agent === undefined) return { roster, notes: [], error: 'Could not add.', isModelChanged: false }
  const named = applyProfile(added, agent.id, { ...change, team })
  const greeting = (named.roster.chats[agent.id] ?? []).map(line =>
    line.id === `${agent.id}-hello` ? { ...line, text: `Hi, I'm ${change.name}. Tell me what you need and I'll get started.` } : line,
  )

  return { ...named, roster: { ...named.roster, chats: { ...named.roster.chats, [agent.id]: greeting } }, notes: [], agentId: agent.id }
}

// Sets or clears a member's photo by name.
export const setPhoto = (roster: Roster, name: string, photo: string | undefined): { roster: Roster; error?: string } => {
  const agent = roster.agents.find(one => handleOf(one.name) === handleOf(name))
  if (agent === undefined) return { roster, error: `There is no team member called ${name}.` }
  const { photo: _old, ...rest } = agent
  const next: Agent = photo === undefined ? rest : { ...rest, photo }

  return { roster: { ...roster, agents: roster.agents.map(one => (one.id === agent.id ? next : one)) } }
}

// The filled pane's own history scrolling. The pane is drawn one screen tall and the history is a clipped window
// over its rows, moved by the person's wheel (`ui.scroll`, denied so the pane itself stays put). Rows are estimated
// from the words: a message's lines wrapped at its bubble's width, plus its frame and gap.

// The rows `text` takes wrapped at `width` columns.
export const wrappedRows = (text: string, width: number): number =>
  text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / Math.max(8, width))), 0)

// The rows a wheel move asks for: a tick (`by` ±1, a few as ticks crowd) moves three rows, as a mouse wheel does;
// anything larger (a page key, Home/End, a trackpad fling) moves exactly as asked.
export const wheelRows = (by: number): number => (Math.abs(by) <= 5 ? by * 3 : by)

// How far the window sits above the newest row after a move: never below the newest, never past the oldest.
export const scrolledBack = (current: number, by: number, heights: readonly number[], viewRows: number): number => {
  const total = heights.reduce((sum, rows) => sum + rows, 0)
  return Math.min(Math.max(0, total - viewRows), Math.max(0, current - wheelRows(by)))
}

// Which rows to draw for a window `back` rows above the newest: from `start` to `end` (exclusive). At the oldest end
// the window is drawn from the top (`isAtTop`); otherwise from the bottom, the oldest drawn row clipped at the top.
export const historyWindow = (heights: readonly number[], back: number, viewRows: number): { start: number; end: number; isAtTop: boolean } => {
  const total = heights.reduce((sum, rows) => sum + rows, 0)
  const most = Math.max(0, total - viewRows)
  if (total > viewRows && back >= most) {
    let end = 0
    for (let rows = 0; end < heights.length && rows < viewRows; end += 1) rows += heights[end] ?? 0
    return { start: 0, end, isAtTop: true }
  }
  let end = heights.length
  for (let skipped = 0; end > 0 && skipped + (heights[end - 1] ?? 0) <= back; end -= 1) skipped += heights[end - 1] ?? 0
  let start = end
  for (let rows = 0; start > 0 && rows < viewRows; start -= 1) rows += heights[start - 1] ?? 0
  return { start, end, isAtTop: false }
}
