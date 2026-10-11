import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'
import type { Roster } from '../types'
import { addAgent, emptyRoster } from '../hooks/model'

// Shared setup for the agent-mode tests: the stand-in engine, fixtures and drawing helpers.

export const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
export const SURFACES = ['terminal', 'desktop'] as const
export const PROFILE = 'mcp__agent-mode__update_my_profile'
export const MESSAGE = 'mcp__agent-mode__message_teammate'
export const ADD = 'mcp__agent-mode__add_agent'
export const BRIEF = 'mcp__agent-mode__get_briefing'
export const briefing = async ($: Engine, loop: string) => String((await $.tool.call({ tool: BRIEF, agentId: loop } as never)).result)

export const PANE = {
  plugin: 'agent-mode',
  component: 'Pane',
  requestId: 'agent-mode',
  props: { title: 'Agents', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

export const BAND = {
  plugin: 'agent-mode',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 100, scroll: { offset: 0, bodyRows: 29 }, view: {} },
} as const

export type World = { gate?: Promise<void>; copies: string[]; drop?: string; opens: string[]; spawns: AgentSpawnInput[]; prompts: { text: string; context: readonly string[] }[]; appended: { agentId?: string; text: string }[]; done: Set<string>; clock: MockClock }

export const two = (): Roster => addAgent(addAgent(emptyRoster(), 'Team', NOW - 2000), 'Team', NOW - 1000)

export const world = (on: On, saved: Roster | null = two(), isPaneOpen = false): World => {
  const seen: World = { copies: [], opens: [], spawns: [], prompts: [], appended: [], done: new Set(), clock: mock.clock(on, { now: NOW }) }
  mock.store(on, saved === null ? {} : { roster: saved, isPaneOpen })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__agent-mode__${e.name}` } }))
  on('ui.open', ($, e) => {
    seen.opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.copy', ($, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  // Stands in for the engine's own drawing beneath the plugin's render hooks.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { text?: unknown }
    return <Text>{typeof props.text === 'string' ? props.text : `engine ${e.component}`}</Text>
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('agent.spawn', ($, e) => {
    seen.spawns.push(e)
    return { model: e.model ?? 'sonnet', agentId: `loop-${seen.spawns.length}` }
  })
  on('agent.list', () => ({
    value: seen.spawns.map((spawn, index) => ({
      id: `loop-${index + 1}`,
      description: spawn.description,
      type: 'general-purpose',
      status: seen.done.has(`loop-${index + 1}`) ? ('completed' as const) : ('running' as const),
    })),
  }))
  on('turn.complete', ($, e) => {
    if (e.agentId !== undefined) seen.done.add(e.agentId)
    return { text: e.answer }
  })
  on('prompt.submit', async ($, e) => {
    // A held gate keeps the submit waiting, as a slow acceptance would.
    if (seen.gate !== undefined) await seen.gate
    if (seen.drop !== undefined) return { drop: seen.drop }
    seen.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text }
  })
  on('session.append', ($, e, next) => {
    const block = e.message.content[0] as { text?: string } | undefined
    seen.appended.push({ agentId: e.agentId, text: block?.text ?? '' })
    return next(e)
  })

  return seen
}

export const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

// What Claude's Agent tool raises when it starts a panel agent.
export const claudeStarts = ($: Engine, name: string, id = `toolu_${name}`) =>
  $.agent.spawn({
    tool_use_id: id,
    prompt: 'intro',
    name: name.toLowerCase().replace(/\s+/g, '-'),
    description: `Team member: ${name}`,
    subagentType: 'general-purpose',
    parentModel: 'opus',
    background: true,
    fork: false,
  } as AgentSpawnInput)

export const typed = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

export const complete = (agentId: string, answer: string) => ({
  answer,
  durationMs: 10,
  isAborted: false,
  turnId: `turn-${agentId}`,
  agentId,
  reason: 'answer' as const,
  text: answer,
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'sonnet' },
})

export const card = (tool_use_id: string, name: string) =>
  ({
    plugin: 'agent-mode',
    component: 'ToolUse',
    requestId: tool_use_id,
    props: { tool_use_id, tool: 'Agent', input: { description: `Team member: ${name}`, prompt: 'intro' }, isRunning: false, isErrored: false, isInterrupted: false },
  }) as const

export const many = (count: number): Roster => {
  let roster = emptyRoster()
  for (let index = 0; index < count; index += 1) roster = addAgent(roster, 'Team', NOW - 10_000 + index)
  return roster
}

// Types into a desktop field the plugin draws (a Client) and presses Enter.
export const typeInto = async (ui: { resize: (size: never) => Promise<void>; pointer: (event: never) => Promise<void>; key: (event: never) => Promise<void> }, box: string, words: string) => {
  await ui.resize({ columns: 30, rows: 3, in: box } as never)
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: box } as never)
  for (const key of words) await ui.key({ key: key === ' ' ? 'space' : key, in: box } as never)
  await ui.key({ key: 'return', in: box } as never)
}

// Opens an agent the way the surface offers: its name Button (terminal), or a press on its row (desktop layer).
export type Drawing = { find: (query: never) => Promise<unknown>; press: (target: never) => Promise<unknown>; pointer: (event: never) => Promise<void> }
export const openAgent = async (ui: Drawing, id: string): Promise<unknown> =>
  (await ui.find({ type: 'Button', key: `open:${id}` } as never)) !== undefined
    ? ui.press({ key: `open:${id}` } as never)
    : ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${id}` } as never)
// Whether an agent's row is drawn with a way to open it: its name Button or its row layer.
export const canOpen = async (ui: Drawing, id: string): Promise<boolean> =>
  (await ui.find({ type: 'Button', key: `open:${id}` } as never)) !== undefined || (await ui.find({ type: 'Client', key: `pick:${id}` } as never)) !== undefined

// A drawn portrait by its exact description (the kit's find does not match on `alt`).
export const portrait = async (ui: { findAll: (query: never) => Promise<unknown[]> }, alt: string) =>
  ((await ui.findAll({ type: 'Svg' } as never)) as { props: { alt?: string; source?: string } }[]).find(one => one.props.alt === alt)

export const ID1 = two().agents[0]!.id
export const ID2 = two().agents[1]!.id

export const field = async (ui: { find: (q: never) => Promise<unknown> }, id: string) =>
  ((await ui.find({ key: `compose:${id}` } as never)) as { props?: { value?: string } } | undefined)?.props?.value


// The opening of the row as the live v0.1.5 session stored it: the host's frame, then the handover.
export const LIVE_WRAPPED = [
  'The agent-mode plugin sent a message:',
  'Agent mode: start my teammate Builder. Call the Agent tool once with name "builder", description "Team member: Builder", subagent_type "general-purpose", model "opus", run_in_background true, and exactly the prompt below.',
  'Do not answer it yourself. When Builder reports back, reply with one line only: "Builder answered in the Agents inbox." Do not repeat or summarise its answer.',
  '',
  'You are Builder, Implementation in the Research team of Agent mode, a team of named agents the person talks to through Claude in the main chat.',
].join('\n')

export const row = (text: string, origin: object, isExpanded: boolean, surface: 'desktop' | 'terminal') => ({
  plugin: 'agent-mode',
  component: 'UserMessage' as const,
  props: { text, origin, isExpanded } as never,
  surface,
})


// A gate the test opens by hand: sends wait at prompt.submit until it does.
export const hold = (seen: World): (() => void) => {
  let open = () => {}
  seen.gate = new Promise<void>(resolve => {
    open = () => {
      seen.gate = undefined
      resolve()
    }
  })
  return open
}


export const three = (): Roster => addAgent(two(), 'Team', NOW - 500)


// Opens Edit agents (the settings that were behind Manage agents): + then Edit agents.
export const editAgents = async (ui: { press: (target: never) => Promise<unknown> }) => {
  await ui.press({ key: 'add' } as never)
  await ui.press({ key: 'edit-agents' } as never)
}

// Texts in the chat, leaving out the list's one-line previews (cut at their edge).
export const inChat = async (ui: { findAll: (query: never) => Promise<unknown[]> }, text: RegExp) =>
  ((await ui.findAll({ text } as never)) as { type?: string; props?: { wrap?: string } }[]).filter(
    one => one.type === 'Markdown' || (one.type === 'Text' && one.props?.wrap !== 'truncate-end'),
  )
