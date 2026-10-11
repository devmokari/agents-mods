import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Ask, Asks, Roster, Run } from '../types'
import { ADD_SCHEMA, AGENT_PREFIX, MESSAGE_SCHEMA, MODELS, PROFILE_SCHEMA, addAgent, emptyRoster, addMember, addTeam, addUsage, applyProfile, clock, findTeammate, handleOf, historyWindow, scrolledBack, wrappedRows, intro, isRoster, liveLoopFor, markRead, noteLine, panelFor, preview, readProfileChange, removeTeam, renameLegacyTeam, replyLine, sections, sendLine, setPhoto, setStatus, shortPreview, teammateText, toRows, unreadOf } from './model'
import type { Incoming } from './model'
import { PHOTO_MAX, PHOTO_SCHEMA, photoType, portraitSvg, withDot } from './faces'
import { BRIEF_SCHEMA, BRIEF_TOOL, activityOf, addStep, answerAsk, askToDeliver, bindAskLoop, draftAfterSend, dropAsk, endRun, enqueueAsk, handover, handoverTarget, markAskDelivered, markAskSending, reportOf, reportPath, shown, startRun, stepText } from './relay'
import { ADD_TOOL, AGENT_TOOL, BUSY, CARD, COMMAND, MESSAGE_TOOL, PANE, PHOTO_TOOL, PROFILE_TOOL, TITLE, asSeqText, clientBase, clientCopied, clientDrafts, clientGen, clientInflight, clientKey, clientResolved, clientSeq, composerProps, isClientUsable, sending } from './state'

// State the hooks and drawings read; declared here, where the engine's scan lists what the plugin keeps.
const roster = atom({ plugin: 'agents', key: 'roster' } as const, emptyRoster())
const selected = atom({ plugin: 'agents', key: 'selected' } as const, null)
const isPaneOpen = atom({ plugin: 'agents', key: 'isPaneOpen' } as const, false)
const runs = atom({ plugin: 'agents', key: 'runs' } as const, {} as Record<string, string>)
const asks = atom({ plugin: 'agents', key: 'asks' } as const, {} as Asks)
const history = atom({ plugin: 'agents', key: 'history' } as const, {} as Record<string, Run>)
const cards = atom({ plugin: 'agents', key: 'cards' } as const, {} as Record<string, string>)
const confirming = atom({ plugin: 'agents', key: 'confirming' } as const, null)
const isManaging = atom({ plugin: 'agents', key: 'isManaging' } as const, false)
const drafts = atom({ plugin: 'agents', key: 'drafts' } as const, {} as Record<string, string>)
const sendErrors = atom({ plugin: 'agents', key: 'sendErrors' } as const, {} as Record<string, string>)
const briefs = atom({ plugin: 'agents', key: 'briefs' } as const, {} as Record<string, string>)
const manageErrors = atom({ plugin: 'agents', key: 'manageErrors' } as const, {} as Record<string, string>)
const editing = atom({ plugin: 'agents', key: 'editing' } as const, null as string | null)
const listFilter = atom({ plugin: 'agents', key: 'listFilter' } as const, '')
const isSearching = atom({ plugin: 'agents', key: 'isSearching' } as const, false)
const expanded = atom({ plugin: 'agents', key: 'expanded' } as const, {} as Record<string, true>)
const menuOpen = atom({ plugin: 'agents', key: 'menuOpen' } as const, null as string | null)
const renaming = atom({ plugin: 'agents', key: 'renaming' } as const, null as string | null)
const isAdding = atom({ plugin: 'agents', key: 'isAdding' } as const, false)
const historyBack = atom({ plugin: 'agents', key: 'historyBack' } as const, {} as Record<string, number>)

// The chat the filled pane last drew with its own scrolling: whose, its rows' estimated heights and the window's rows,
// for the `ui.scroll` hook to move. Undefined while the pane scrolls natively (tiled, Edit agents).
let filledChat: { id: string; heights: number[]; viewRows: number } | undefined

// Whether the pane was last drawn filled (wide enough for the chat) or tiled (the list alone). Only a chat on screen
// in the filled pane counts as read: picking an agent in the tiled list leaves its unread count alone.
// ponytail: one flag for the session; a session drawing the pane on two surfaces at once takes the latest.
let isFilled = false
// Cells that hold the list's 44px photo and the pill's 32px one (a cell is about 8px wide, 17px tall).
// ponytail: fixed cell estimates; read the surface's cell size if the host ever reports it.
const PHOTO_BOX = { columns: 6, rows: 3 }
const PILL_PHOTO_BOX = { columns: 5, rows: 2 }
// A card's cells in the filled pane's bottom bar, near the mock's 235px: photo, name with ⋯, preview and count.
const BAR_CARD_COLUMNS = 26
// The list's icons, as large as glyphs allow (a Button takes no font size, nor any child but its one string label):
// the magnifier in text presentation and a full-width plus.
const SEARCH_ICON = '\u{1F50D}\uFE0E'
const ADD_ICON = '\uFF0B'
// The agent whose chat the filled pane drew with an unread count, for the session's timer to mark read: a render
// cannot write state itself (a write it starts does not land), so it leaves the id here.
let seenUnread: string | undefined
// Set when the filled chat is drawn with its pane scrolled down (switching from tile, which scrolls natively, can leave
// it there): the session's timer scrolls the pane back to its top, since a render cannot scroll it itself.
let needsTop = false

// The panel agent a subagent loop belongs to: recorded at its start, else found by its description.
async function panelOf($: EngineInterface, loop: string): Promise<string | undefined> {
  const known = (await read($, runs))[loop]
  if (known !== undefined) return known
  const info = (await $.agent.list().catch(() => [])).find(one => one.id === loop)
  const found = info === undefined ? undefined : panelFor(await read($, roster), info.description)
  if (found !== undefined) {
    const at = await $.clock.now()
    await update($, runs, all => ({ ...all, [loop]: found }))
    await update($, history, all => (all[loop] === undefined ? startRun(all, loop, found, at) : all))
  }

  return found
}

// The subagent loop a panel agent is running in, if it runs.
async function loopOf($: EngineInterface, id: string): Promise<string | undefined> {
  const map = await read($, runs)

  return Object.keys(map).find(loop => map[loop] === id) ?? liveLoopFor(await $.agent.list().catch(() => []), await read($, roster), id)
}

// Hands a teammate's message to a panel agent: into its running loop, else to Claude, who starts it.
// Claude starts every agent: one the plugin started itself would run without this plugin's tools.
async function deliver($: EngineInterface, toId: string, incoming: Incoming, askId?: string): Promise<void> {
  const running = await loopOf($, toId)
  if (running !== undefined) {
    const text = teammateText(incoming.from, incoming.text, incoming.isReply)
    const isAppended = await $.session
      .append({ message: { type: 'user', content: [{ type: 'text', text }] }, agentId: running })
      .then(
        result => result.deny === undefined,
        () => false,
      )
    if (isAppended) {
      if (askId !== undefined) await update($, asks, all => markAskDelivered(all, toId, askId, running))
      await update($, roster, all => setStatus(all, toId, 'thinking'))
      return
    }
    await update($, runs, all => Object.fromEntries(Object.entries(all).filter(([loop]) => loop !== running)))
  }
  const text = await handOver($, await read($, roster), toId, false, '', incoming)
  if (text === '') {
    if (askId !== undefined) await update($, asks, all => dropAsk(all, toId, askId))
    return
  }
  // Out with Claude to start the teammate; the loop it starts is tied to the request at its spawn.
  if (askId !== undefined) await update($, asks, all => markAskDelivered(all, toId, askId))
  await $.prompt.submit({ text })
}

// A start's handover is a few lines; the agent's full briefing waits here for its get_briefing call.
async function handOver(
  $: EngineInterface,
  all: Roster,
  id: string,
  isRunning: boolean,
  text: string,
  incoming?: Incoming,
  relay?: 'full' | 'inbox',
): Promise<string> {
  if (!isRunning) {
    const brief = intro(all, id, incoming)
    await update($, briefs, saved => ({ ...saved, [id]: brief }))
  }

  return handover(all, id, isRunning, text, relay)
}

// The roster this plugin saved while it was named agent-mode (its store files, `agent-mode_*.json`, beside this
// plugin's own): the fullest one, or none.
async function legacyRoster($: EngineInterface): Promise<Roster | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (home === undefined || home === '') return undefined
  const dir = `${home}/.claude/plugins/store`
  const entries = await $.fs.list(dir).catch(() => [])
  let best: Roster | undefined
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.startsWith('agent-mode_') || !entry.name.endsWith('.json')) continue
    const text = await $.fs.read(`${dir}/${entry.name}`).catch(() => undefined)
    let found: unknown
    try {
      found = typeof text === 'string' ? (JSON.parse(text) as { roster?: unknown }).roster : undefined
    } catch {
      found = undefined
    }
    if (isRoster(found) && (best === undefined || found.agents.length > best.agents.length)) best = renameLegacyTeam(found)
  }
  return best
}

async function save($: EngineInterface, change: (all: Roster) => Roster): Promise<Roster> {
  const saved = await update($, roster, change)
  await $.store.set('roster', saved)

  return saved
}

// The person's words from the inbox go to the agent named here and now: a later pick cannot move them.
// Resolves whether the handover entered Claude's chat. A refused one leaves no line behind and the agent as it was.
async function sendTo($: EngineInterface, id: string, words: string): Promise<{ isSent: true } | { isSent: false; reason: string }> {
  const text = words.trim()
  if (text === '') return { isSent: false, reason: 'Nothing to send.' }
  const before = (await read($, roster)).agents.find(one => one.id === id)
  if (before === undefined) return { isSent: false, reason: 'That agent no longer exists.' }
  const isRunning = (await loopOf($, id)) !== undefined
  const now = await $.clock.now()
  const sent = await save($, all => sendLine(all, id, text, now))
  // A send shows the newest messages, as a messaging app does.
  await update($, historyBack, all => ({ ...all, [id]: 0 }))
  await revealNewest($)
  const lineId = sent.chats[id]?.at(-1)?.id
  const message = await handOver($, sent, id, isRunning, text, undefined, 'inbox')
  const reason = await $.prompt.submit({ text: message }).then(
    result => result.drop,
    (error: unknown) => (error instanceof Error ? error.message : String(error)) || 'The message did not reach Claude.',
  )
  if (reason === undefined) {
    return { isSent: true }
  }
  await save($, all =>
    setStatus({ ...all, chats: { ...all.chats, [id]: (all.chats[id] ?? []).filter(line => line.id !== lineId) } }, id, before.status),
  )

  return { isSent: false, reason }
}

// The one way a composer sends: refused while the same agent's previous send is still waiting to be taken.
async function sendGuarded($: EngineInterface, id: string, words: string): Promise<{ isSent: true } | { isSent: false; reason: string }> {
  if (sending[id]) return { isSent: false, reason: BUSY }
  sending[id] = true
  try {
    return await sendTo($, id, words)
  } finally {
    delete sending[id]
  }
}

const errorAfter = (all: Record<string, string>, id: string, words: string, outcome: { isSent: boolean; reason?: string }) => {
  const next = { ...all }
  if (outcome.isSent || words.trim() === '') delete next[id]
  else next[id] = outcome.reason ?? 'The message did not reach Claude.'
  return next
}


// A new agent's portrait from the shipped photos (photos/001.jpg … 100.jpg), by the number in its id.
const PHOTOS = 100
async function stockPhoto($: EngineInterface, agentId: string | undefined): Promise<void> {
  const number = Number(agentId?.split('-').pop())
  if (agentId === undefined || !Number.isInteger(number) || number < 1) return
  const file = `${$.plugin.root}/photos/${String(((number - 1) % PHOTOS) + 1).padStart(3, '0')}.jpg`
  const photo = await $.fs.read(file, { as: 'bytes' }).then(
    read => `data:image/jpeg;base64,${read.base64}`,
    () => undefined,
  )
  if (photo !== undefined) await save($, all => ({ ...all, agents: all.agents.map(one => (one.id === agentId && one.photo === undefined ? { ...one, photo } : one)) }))
}

// Saves one Manage agents field: a name only when no other agent's handle routes to it (the reason shown if not).
// Resolves whether it was saved.
async function saveField($: EngineInterface, id: string, kind: 'name' | 'title', value: string): Promise<boolean> {
  const change = kind === 'name' ? { name: value } : { title: value.trim() }
  const check = applyProfile(await read($, roster), id, change)
  await update($, manageErrors, all => {
    const next = { ...all }
    if (check.error === undefined) delete next[id]
    else next[id] = check.error
    return next
  })
  if (check.error !== undefined) return false
  await save($, all => applyProfile(all, id, change).roster)
  return true
}

// Picks an agent from anywhere (its row, its name, Manage agents): out of Manage, menus closed, at its newest
// messages. Read only when the filled pane shows its chat; a pick in the tiled list keeps the unread count.
async function pickAgent($: EngineInterface, id: string): Promise<void> {
  if (!(await read($, roster)).agents.some(one => one.id === id)) return
  await update($, selected, () => id)
  await update($, isManaging, () => false)
  await update($, editing, () => null)
  await update($, menuOpen, () => null)
  await update($, isAdding, () => false)
  if (isFilled) await save($, all => markRead(all, id))
  await revealNewest($)
}

// Deletes an agent with its chat, draft, error and queued requests; the pick moves off it.
async function deleteAgent($: EngineInterface, id: string): Promise<void> {
  await save($, all => {
    const chats = { ...all.chats }
    delete chats[id]
    return { ...all, agents: all.agents.filter(other => other.id !== id), chats }
  })
  const without = <T,>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id))
  await update($, drafts, without)
  await update($, sendErrors, without)
  await update($, asks, without)
  delete clientDrafts[id]
  await update($, confirming, () => null)
  await update($, editing, () => null)
  await update($, menuOpen, () => null)
  await update($, renaming, open => (open === id ? null : open))
  if ((await read($, selected)) === id) await update($, selected, () => null)
}

// Asks the surface to show the end of the inbox (the newest message and the composer). `end` keeps up with the tree
// as it grows until the person scrolls, so a reading position further up is left alone after that.
// The ask is made again after the redraw has had time to land: asked at once, `end` is the end of the drawing the
// change has not yet replaced (the previous agent's chat, the inbox before it opened). A refusal's reason is kept
// in the store under `scrollRefused` (the last 5), so a live run says why the pane did not move.
const revealNewest = async ($: EngineInterface): Promise<unknown> => {
  const ask = () =>
    $.ui
      // The filled chat scrolls itself, its pane held at the top; elsewhere the pane's end is the newest.
      .scroll({ to: filledChat === undefined ? 'end' : 'start', in: PANE })
      .then(async result => {
        if (result.deny === undefined) return
        const kept = await $.store.get('scrollRefused')
        await $.store.set('scrollRefused', [...(Array.isArray(kept) ? kept : []), { at: await $.clock.now(), reason: result.deny }].slice(-5))
      })
      .catch(() => undefined)
  await ask()
  void (async () => {
    for (const wait of [120, 400, 1000]) {
      await $.clock.sleep(wait).catch(() => undefined)
      await ask()
    }
  })()

  return undefined
}

async function openInbox($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE })
  await revealNewest($)
  await update($, isPaneOpen, () => true)
  await $.store.set('isPaneOpen', true)
}

export const register: Register = on => {
  // Tool calls in flight per subagent: overlapping calls keep it acting until the last ends.
  const acting: Record<string, number> = {}

  // Teammate deliveries wait here for the session's own timer, outside the tool call that raised them.
  const outbox: { toId: string; incoming: Incoming; askId?: string }[] = []
  let isDraining = false

  on('session.start', async ($, e, next) => {
    const held = await $.state.get({ plugin: 'agents', key: 'roster' } as const)
    if (held.version === 0) {
      const saved = await $.store.get('roster')
      if (isRoster(saved)) {
        const renamed = renameLegacyTeam(saved)
        await update($, roster, () => renamed)
        if (renamed !== saved) await $.store.set('roster', renamed)
      } else {
        // First start under the plugin's new name: the agents and chats saved under the old one come across once.
        const legacy = await legacyRoster($)
        if (legacy !== undefined) {
          await update($, roster, () => legacy)
          await $.store.set('roster', legacy)
        }
      }
    }
    await $.command.register({ name: COMMAND, description: 'Open the Agents inbox' })
    await $.tool.register({
      name: 'update_my_profile',
      description:
        'Agent mode team members only: change your own name, title, team, model, abilities or attributes when the person asks. Give only the fields that change.',
      inputSchema: PROFILE_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'message_teammate',
      description:
        'Agent mode team members only: send a message to a teammate by name to split work or ask for help. A stopped teammate is started for it; their reply comes back to you as a message.',
      inputSchema: MESSAGE_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'get_briefing',
      description:
        'Agent mode team members only: your briefing for this run (who you are, your teammates, the chat so far and the message to answer). Call it first.',
      inputSchema: BRIEF_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'add_agent',
      description:
        "Adds a named team member to the person's Agent mode panel (name, and optionally title, team, model, abilities, attributes). Main Claude only, when the person asks for a new agent.",
      inputSchema: ADD_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'set_agent_photo',
      description: "Sets a team member's portrait in the Agent mode panel from an image file, or clears it back to the drawn face. Main Claude only, when the person asks.",
      inputSchema: PHOTO_SCHEMA,
      isDeferred: false,
    })
    $.clock.every(500, () => {
      // A chat the filled pane showed with unread replies: read now, if the pane is still filled.
      const seen = seenUnread
      seenUnread = undefined
      if (seen !== undefined && isFilled) void save($, all => markRead(all, seen)).catch(() => undefined)
      // The filled chat was drawn with its pane scrolled down (left there by the tiled list, or by the pane following
      // its end as the tree grew): put it back at the top, where the pill, history, composer and bar fit the screen.
      if (needsTop && filledChat !== undefined) void $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
      needsTop = false
      if (isDraining || outbox.length === 0) return
      isDraining = true
      void (async () => {
        try {
          for (let job = outbox.shift(); job !== undefined; job = outbox.shift()) await deliver($, job.toId, job.incoming, job.askId)
        } finally {
          isDraining = false
        }
      })()
    })
    // No send is in flight at a start: the composers' bookkeeping starts empty.
    for (const map of [clientDrafts, clientSeq, clientInflight, clientResolved, clientCopied, sending, clientGen] as Record<string, unknown>[]) {
      for (const key of Object.keys(map)) delete map[key]
    }
    // A session that starts again has no running subagents: every agent is idle.
    const restored = await update($, roster, all => ({ ...all, agents: all.agents.map(agent => ({ ...agent, status: 'ready' as const })) }))
    await $.store.set('roster', restored)
    // The inbox comes back where the person left it open.
    if ((await $.store.get('isPaneOpen')) === true) {
      await update($, isPaneOpen, () => true)
      void $.ui.open({ id: PANE, title: TITLE }).then(() => revealNewest($))
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openInbox($)
    // The version is the manifest's, so the reply never drifts from what is installed.
    const version = await $.fs
      .read(`${$.plugin.root}/.claude-plugin/plugin.json`)
      .then(text => (JSON.parse(text) as { version?: unknown }).version, () => undefined)

    return { text: typeof version === 'string' ? `Agents inbox opened (v${version}).` : 'Agents inbox opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isPaneOpen, () => false)
      await $.store.set('isPaneOpen', false)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The Agents inbox. Filled (70 columns or more, the only sign the host gives of a maximised pane): the list on the
  // left, the picked agent's chat on the right. Tiled: the list alone. Edit agents (from +) takes the chat's place,
  // and shows in the tiled pane too, when asked for or when there is no agent yet.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const team: Roster = await read($, roster)
    const doomed = await read($, confirming)
    const fieldErrors = await read($, manageErrors)
    const editingNow = await read($, editing)
    const runsNow = await read($, runs)
    const asksNow = await read($, asks)
    const isGraphic = e.surface !== 'terminal' && 'Svg' in ui
    const isDesktopClient = e.surface === 'desktop' && 'Client' in ui
    // A surface that sends no width lets the pane size itself; NaN would refuse the whole tree.
    const width = Number.isFinite(e.props.bodyColumns) ? Math.max(20, e.props.bodyColumns) : undefined
    const isWide = width === undefined || width >= 70
    const chatColumns = width === undefined ? 60 : width
    const chosen = await read($, selected)
    const agent = team.agents.find(one => one.id === chosen) ?? team.agents[0]
    const isManagingNow = (await read($, isManaging)) || agent === undefined
    const now = await $.clock.now()
    // The search box narrows the list to agents whose name or title holds its words.
    const filterNow = (await read($, listFilter)).trim().toLowerCase()
    const searchingNow = await read($, isSearching)
    const matches = (one: Agent) => filterNow === '' || `${one.name} ${one.title}`.toLowerCase().includes(filterNow)
    const shownSections = sections(team)
      .map(section => ({ ...section, agents: section.agents.filter(matches) }))
      .filter(section => section.agents.length > 0)

    // A labelled field row in Manage agents: every label the same width, so the controls line up; in a narrow pane the
    // label sits above its control, which then has the panel's whole width.
    // A plugin text field is always stacked: beside a label, its 100% width ran past the panel and hid its ✓ (live).
    const field = (key: string, label: string, control: unknown, isStacked = false) => {
      const isBeside = isWide && !isStacked
      return (
        <Box key={key} flexDirection={isBeside ? 'row' : 'column'} gap={isBeside ? 1 : 0} alignItems={isBeside ? 'center' : 'stretch'}>
          <Box width={isBeside ? 7 : undefined} flexShrink={0}>
            <Text color={CARD.secondary}>{label}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} width={isBeside ? undefined : '100%'}>
            {control as never}
          </Box>
        </Box>
      )
    }

    // A text field for Manage agents. The desktop's own Input keeps a fixed width that runs past a narrow panel, so
    // there the plugin's full-width field is used (Enter or ✓ saves); elsewhere the surface's Input.
    const textField = (base: string, placeholder: string, save: (value: string) => Promise<unknown>) =>
      isDesktopClient && isClientUsable(base) ? (
        <ui.Client
          key={clientKey(base)}
          module="./composer.tsx"
          props={{ draft: clientDrafts[base] ?? '', placeholder, sending: clientInflight[base] ?? null, resolved: clientResolved[base] ?? null, lastSeq: clientSeq[base] ?? 0, glyph: '✓' }}
          width="100%"
        />
      ) : 'Input' in ui ? (
        <ui.Input key={base} placeholder={placeholder} submitLabel="Save" onSubmit={value => void save(value)} />
      ) : null


    // One agent's Edit panel: name, title, team, model and pin, the same spacing for each; Delete set apart below.
    const editPanel = (one: Agent) => (
      <Box key={`edit-${one.id}`} flexDirection="column" gap={1} marginTop={1} paddingX={1} borderStyle="round" borderColor={CARD.border}>
        {field('name', 'Name', textField(`rename:${one.id}`, one.name, value => saveField($, one.id, 'name', value)), isDesktopClient && isClientUsable(`rename:${one.id}`))}
        {field('title', 'Title', textField(`retitle:${one.id}`, one.title || 'No title', value => saveField($, one.id, 'title', value)), isDesktopClient && isClientUsable(`retitle:${one.id}`))}
        {isDesktopClient && (
          // Enter or ✓ saves one field; this saves whatever is typed in both, for anyone who looks for a Save button.
          <Box key="save-fields" flexDirection="row">
            <Button
              key={`save-fields:${one.id}`}
              plain
              label="Save name and title"
              onPress={async () => {
                const name = (clientDrafts[`rename:${one.id}`] ?? '').trim()
                const title = (clientDrafts[`retitle:${one.id}`] ?? '').trim()
                if (name !== '') await saveField($, one.id, 'name', name)
                if (title !== '') await saveField($, one.id, 'title', title)
              }}
            />
          </Box>
        )}
        {'Select' in ui &&
          field(
            'team',
            'Team',
            <ui.Select
              key={`team:${one.id}`}
              value={one.team}
              options={team.teams.map(name => ({ value: name }))}
              onSelect={value => save($, all => applyProfile(all, one.id, { team: value }).roster)}
            />,
          )}
        {'Select' in ui &&
          field(
            'model',
            'Model',
            <ui.Select
              key={`model:${one.id}`}
              value={one.model}
              options={MODELS.map(model => ({ value: model }))}
              onSelect={value => save($, all => applyProfile(all, one.id, { model: value }).roster)}
            />,
          )}
        {field(
          'pin',
          'List',
          <Button
            key={`pin:${one.id}`}
            plain
            label={one.isPinned ? 'Unpin' : 'Pin first'}
            onPress={() => save($, all => ({ ...all, agents: all.agents.map(other => (other.id === one.id ? { ...other, isPinned: !other.isPinned } : other)) }))}
          />,
        )}
        {fieldErrors[one.id] !== undefined && (
          <Text key={`rename-error:${one.id}`} color="red">
            {`Not saved: ${fieldErrors[one.id]}`}
          </Text>
        )}
        <Box key="danger" flexDirection="row" gap={1} alignItems="center" marginTop={1}>
          {doomed === one.id ? (
            <>
              <Button
                key={`delete:${one.id}`}
                plain
                label={`Delete ${one.name} and its chat? Press again`}
                onPress={() => deleteAgent($, one.id)}
              />
              <Button key={`keep:${one.id}`} plain dimColor label="Cancel" onPress={() => update($, confirming, () => null)} />
            </>
          ) : (
            <Button key={`delete:${one.id}`} plain dimColor label="Delete agent…" onPress={() => update($, confirming, () => one.id)} />
          )}
        </Box>
      </Box>
    )

    const managing = (
      <Box key="manage" flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text bold>Manage agents</Text>
          {agent !== undefined && <Button key="done" plain dimColor label="Done" onPress={() => update($, isManaging, () => false)} />}
        </Box>
        {sections(team).map(section => (
          <Box key={`section-${section.title}`} flexDirection="column" marginTop={1}>
            <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
              <Text bold color={CARD.secondary}>
                {section.title}
              </Text>
              {section.team !== undefined && (
                <Button
                  key={`add:${section.team}`}
                  plain
                  dimColor
                  label="Add agent"
                  onPress={async () => {
                    const at = await $.clock.now()
                    const added = await save($, all => addAgent(all, section.team ?? '', at))
                    await stockPhoto($, added.agents.at(-1)?.id)
                  }}
                />
              )}
              {section.team !== undefined && section.agents.length === 0 && (
                <Button key={`delete-team:${section.team}`} plain dimColor label="Delete empty team" onPress={() => save($, all => removeTeam(all, section.team ?? ''))} />
              )}
            </Box>
            {section.agents.map(one => (
              <Box key={`agent-${one.id}`} flexDirection="column">
                <Box flexDirection="row" gap={1} alignItems="center">
                  {isGraphic && 'Svg' in ui && <ui.Svg source={portraitSvg(one, one.status)} alt={`${one.name} portrait`} width={24} height={24} />}
                  <Text bold>{one.name}</Text>
                  <Text color={CARD.secondary} wrap="truncate-end">
                    {[one.title, one.team, one.model].filter(Boolean).join(' · ')}
                  </Text>
                  <Button
                    key={`edit:${one.id}`}
                    plain
                    label={editingNow === one.id ? 'Close' : 'Edit'}
                    onPress={async () => {
                      await update($, confirming, () => null)
                      await update($, editing, open => (open === one.id ? null : one.id))
                    }}
                  />
                </Box>
                {editingNow === one.id && editPanel(one)}
              </Box>
            ))}
          </Box>
        ))}
        {'Input' in ui && (
          <Box marginTop={1}>
            {field('new-team', 'Team', <ui.Input key="new-team" placeholder="New team name" submitLabel="Add" onSubmit={value => save($, all => addTeam(all, value))} />)}
          </Box>
        )}
      </Box>
    )

    // The list, WhatsApp style: the portrait (a dot while the agent works or waits), the name, the last message cut at
    // 20 characters, and a green unread count when there is one. No title or status words. The picked row and the row
    // under the pointer are tinted; the picked one also takes a border. On desktop pick layers (rowpick.tsx) over the
    // name, the rest of its line and the preview line pick the agent; the photo does not pick, since the desktop gives
    // presses on an image to no plugin layer. The terminal, or a desktop whose name layer failed, uses the name Button.
    // The ⋯ right after the name sits between the layers, never under one; it opens Rename and Delete beneath the row.
    const menuNow = await read($, menuOpen)
    const renamingNow = await read($, renaming)
    const addingNow = await read($, isAdding)
    const card = (one: Agent, cardWidth?: number) => {
      const isPicked = one.id === agent?.id && !isManagingNow
      const last = shortPreview(shown(preview(team, one.id)))
      const count = unreadOf(one)
      const activity = activityOf(team, runsNow, asksNow, one.id)
      const dot = activity.kind === 'working' ? CARD.dotWorking : activity.kind === 'waiting' ? CARD.dotWaiting : undefined
      const state = [activity.label, count > 0 ? `${count} unread` : ''].filter(Boolean).join(', ')
      // Three pick layers, so the ⋯ can sit right after the name and outside them all: over the name, over the rest of
      // the name line, and over the preview line with its count. The photo has none (the desktop keeps image presses).
      const base = `pick:${one.id}`
      const layer = (key: string) =>
        isDesktopClient && isClientUsable(key) ? (
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <ui.Client key={clientKey(key)} module="./rowpick.tsx" props={null} width="100%" height="100%" />
          </Box>
        ) : null
      const hasNameLayer = isDesktopClient && isClientUsable(`${base}:name`)
      const tint = isGraphic && isPicked ? CARD.row : undefined
      const isRenaming = renamingNow === one.id
      const menuButton = (
        <Button
          key={`menu:${one.id}`}
          plain
          dimColor={menuNow !== one.id}
          label="⋯"
          onPress={async () => {
            await update($, confirming, () => null)
            await update($, menuOpen, open => (open === one.id ? null : one.id))
          }}
        />
      )
      return (
        <Box key={`agent-${one.id}`} flexDirection="column" width={cardWidth} flexShrink={0}>
          <Box
            key={`row-${one.id}`}
            flexDirection="row"
            gap={1}
            alignItems="center"
            paddingX={isGraphic ? 1 : 0}
            borderStyle={isGraphic ? 'round' : undefined}
            borderColor={isGraphic ? (isPicked ? CARD.rowBorder : '#00000000') : undefined}
            backgroundColor={tint}
            hover={isGraphic ? (isPicked ? { backgroundColor: CARD.row, borderColor: CARD.rowBorder } : { backgroundColor: CARD.rowHover, borderColor: CARD.rowHover }) : undefined}
          >
            {isGraphic && 'Svg' in ui && (
              // The mock's 44px photo, in a box sized in cells to hold it (the pane lays out in cells, the image in pixels).
              <Box key={`photo-${one.id}`} width={PHOTO_BOX.columns} height={PHOTO_BOX.rows} flexShrink={0} alignItems="center" justifyContent="center">
                <ui.Svg source={withDot(portraitSvg(one, one.status), dot)} alt={`${one.name} portrait${state === '' ? '' : `, ${state}`}`} width={44} height={44} />
              </Box>
            )}
            <Box flexDirection="column" flexShrink={1} flexGrow={1}>
              {isRenaming ? (
                // Rename edits the name in place: the field takes the name line until it is saved or cancelled.
                <Box key={`rename-${one.id}`} flexDirection="row" gap={1} alignItems="center">
                  <Box flexGrow={1} flexShrink={1}>
                    {textField(`relabel:${one.id}`, one.name, async value => {
                      if (await saveField($, one.id, 'name', value)) await update($, renaming, () => null)
                    })}
                  </Box>
                  <Button
                    key={`rename-cancel:${one.id}`}
                    plain
                    dimColor
                    label="Cancel"
                    onPress={async () => {
                      await update($, renaming, () => null)
                      await update($, manageErrors, all => Object.fromEntries(Object.entries(all).filter(([key]) => key !== one.id)))
                    }}
                  />
                </Box>
              ) : (
                <Box key={`line-${one.id}`} flexDirection="row" gap={1} alignItems="center">
                  {hasNameLayer ? (
                    <Box key={`name-${one.id}`} flexShrink={1}>
                      <Text bold wrap="truncate-end">
                        {one.name}
                      </Text>
                      {layer(`${base}:name`)}
                    </Box>
                  ) : (
                    <Button key={`open:${one.id}`} variant={isPicked ? 'primary' : undefined} label={one.name} onPress={() => pickAgent($, one.id)} />
                  )}
                  {menuButton}
                  <Box key={`gap-${one.id}`} flexGrow={1} height={1}>
                    {layer(`${base}:gap`)}
                  </Box>
                </Box>
              )}
              {isRenaming && fieldErrors[one.id] !== undefined && <Text color="error">{`Not saved: ${fieldErrors[one.id]}`}</Text>}
              <Box key={`sub-${one.id}`} flexDirection="row" gap={1} alignItems="center">
                <Box flexGrow={1} flexShrink={1}>
                  <Text color={CARD.secondary} wrap="truncate-end">
                    {last === '' ? ' ' : last}
                  </Text>
                </Box>
                {count > 0 &&
                  (isGraphic ? (
                    <Box key={`unread-${one.id}`} paddingX={1} borderStyle="round" borderColor={CARD.badge} backgroundColor={CARD.badge} flexShrink={0}>
                      <Text bold color={CARD.badgeText}>
                        {String(count)}
                      </Text>
                    </Box>
                  ) : (
                    <Text key={`unread-${one.id}`} bold color="success">
                      {`(${count})`}
                    </Text>
                  ))}
                {layer(base)}
              </Box>
            </Box>
          </Box>
          {menuNow === one.id && doomed !== one.id && (
            <Box key={`menu-${one.id}`} flexDirection="row" gap={2} justifyContent="flex-end" paddingX={1}>
              <Button
                key={`rename-open:${one.id}`}
                plain
                label="Rename"
                onPress={async () => {
                  await update($, menuOpen, () => null)
                  clientDrafts[`relabel:${one.id}`] = ''
                  await update($, renaming, () => one.id)
                }}
              />
              <Button key={`delete-ask:${one.id}`} plain label="Delete" onPress={() => update($, confirming, () => one.id)} />
            </Box>
          )}
          {doomed === one.id && !isManagingNow && (
            // Two steps: Delete in the menu asks; only this second, named press deletes.
            <Box key={`confirm-${one.id}`} flexDirection="column" paddingX={1}>
              <Text color="error">{`Delete ${one.name} and its whole chat? This cannot be undone.`}</Text>
              <Box flexDirection="row" gap={2} justifyContent="flex-end">
                <Button
                  key={`keep:${one.id}`}
                  plain
                  label="Cancel"
                  onPress={async () => {
                    await update($, confirming, () => null)
                    await update($, menuOpen, () => null)
                  }}
                />
                <Button key={`delete:${one.id}`} plain label={`Delete ${one.name}`} onPress={() => deleteAgent($, one.id)} />
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    // Search and + as icons, each in a rounded frame (the host draws its own fixed corner radius, not the mock's circles).
    // + holds a new agent and the agents' settings (title, team, model, pin).
    const toolButtons = (
      <Box key="list-head" flexDirection="row" gap={2} justifyContent={isWide ? 'flex-start' : 'flex-end'} flexShrink={0}>
        <Box key="search-ring" borderStyle={isGraphic ? 'round' : undefined} borderColor={CARD.border} paddingX={isGraphic ? 1 : 0}>
          <Button
            key="search"
            plain
            dimColor={!searchingNow}
            onPress={async () => {
              const isOpen = !(await read($, isSearching))
              await update($, isSearching, () => isOpen)
              if (!isOpen) {
                await update($, listFilter, () => '')
                clientDrafts['search:list'] = ''
              }
            }}
            label={SEARCH_ICON}
          />
        </Box>
        <Box key="add-ring" borderStyle={isGraphic ? 'round' : undefined} borderColor={CARD.border} paddingX={isGraphic ? 1 : 0}>
          <Button key="add" plain dimColor={!addingNow} label={ADD_ICON} onPress={() => update($, isAdding, open => !open)} />
        </Box>
      </Box>
    )
    // What + and search open: the add menu, the search box, and the no-match line.
    const toolPanels = [
      addingNow && (
        <Box key="add-menu" flexDirection="row" gap={2} justifyContent={isWide ? 'flex-start' : 'flex-end'} marginTop={isWide ? 0 : 1}>
          <Button
            key="new-agent"
            plain
            label="New agent"
            onPress={async () => {
              // A new agent in the first team, its Edit panel open to name it.
              const at = await $.clock.now()
              const added = await save($, all => addAgent(all, all.teams[0] ?? '', at))
              const id = added.agents.at(-1)?.id
              await stockPhoto($, id)
              await update($, isAdding, () => false)
              if (id === undefined) return
              await update($, isManaging, () => true)
              await update($, editing, () => id)
            }}
          />
          <Button
            key="edit-agents"
            plain
            label="Edit agents"
            onPress={async () => {
              await update($, isAdding, () => false)
              await update($, isManaging, () => true)
            }}
          />
        </Box>
      ),
      searchingNow &&
        (isDesktopClient && isClientUsable('search:list') ? (
          <Box key="search-box" width={isWide ? 40 : '100%'} marginTop={1}>
            <ui.Client
              key={clientKey('search:list')}
              module="./composer.tsx"
              props={{ draft: clientDrafts['search:list'] ?? '', placeholder: 'Search agents', sending: null, resolved: null, lastSeq: 0, glyph: '⌕' }}
              width="100%"
            />
          </Box>
        ) : 'Input' in ui ? (
          <Box key="search-box" marginTop={1}>
            <ui.Input key="search:list" placeholder="Search agents" submitLabel="⌕" onInput={value => update($, listFilter, () => value)} onSubmit={value => update($, listFilter, () => value)} />
          </Box>
        ) : null),
      searchingNow && shownSections.length === 0 && (
        <Text key="no-match" color={CARD.secondary}>
          No agent matches.
        </Text>
      ),
    ]

    // Tiled: the list alone, in a column, grouped by team under small grey capitals.
    const list = (
      <Box key="list" flexDirection="column" width={width} flexShrink={0}>
        {toolButtons}
        {toolPanels}
        {shownSections.map(section => (
          <Box key={`group-${section.title}`} flexDirection="column" marginTop={1}>
            <Text color={CARD.secondary}>{section.title.toUpperCase()}</Text>
            {section.agents.map(one => card(one))}
          </Box>
        ))}
      </Box>
    )

    // Filled: the bottom agent bar, below the chat: search and + first, then each team under its small grey heading with
    // its people as cards of fixed width. The host has no horizontal scroll, so teams and cards wrap onto more lines.
    const bar = (
      <Box key="agent-bar" flexDirection="column" paddingX={1} paddingY={isGraphic ? 1 : 0} borderStyle={isGraphic ? 'round' : 'single'} borderColor={CARD.border} backgroundColor={isGraphic ? CARD.panel : undefined}>
        <Box key="bar-row" flexDirection="row" gap={2} alignItems="flex-start">
          {toolButtons}
          <Box key="bar-cards" flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1} flexGrow={1} flexShrink={1}>
            {shownSections.map(section => (
              <Box key={`bar-group-${section.title}`} flexDirection="column" flexShrink={1}>
                <Text color={CARD.secondary}>{section.title.toUpperCase()}</Text>
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  {section.agents.map(one => card(one, BAR_CARD_COLUMNS))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
        {toolPanels}
      </Box>
    )

    const paneRows = Number.isFinite(e.props.scroll?.bodyRows) ? Math.max(0, e.props.scroll.bodyRows) : undefined
    // The filled pane scrolls its chat's history itself, keeping the pill, composer and bar in place.
    const isOwnScroll = isWide && !isManagingNow && agent !== undefined && paneRows !== undefined && paneRows > 0
    if (!isOwnScroll) filledChat = undefined
    const backNow = await read($, historyBack)
    const draftsNow = await read($, drafts)
    const errorsNow = await read($, sendErrors)
    // A chat bubble, sized to its words up to the column: the agent's soft grey on the left, the person's unfilled on
    // the right, both in the theme's own text colour (the border takes the fill's colour, for rounded corners).
    // A bubble is at most 70% of the chat column (the mock's max width): one whose longest line runs past that takes
    // exactly that width and wraps; a shorter one is sized to its words. The host has no maxWidth, hence the measure.
    const bubbleCap = isWide ? Math.floor((Math.max(30, Math.round(chatColumns * 0.84)) * 7) / 10) : undefined
    const bubble = (key: string, isMine: boolean, text: string, isRich: boolean) => {
      const longest = Math.max(0, ...text.split('\n').map(line => Array.from(line).length)) + 4
      return (
        <Box
          key={key}
          flexDirection="column"
          alignSelf={isMine ? 'flex-end' : 'flex-start'}
          width={bubbleCap !== undefined && longest > bubbleCap ? bubbleCap : undefined}
          marginTop={1}
          paddingX={1}
          borderStyle="round"
          borderColor={CARD.border}
          backgroundColor={isGraphic && !isMine ? CARD.bubble : undefined}
        >
          {isRich && 'Markdown' in ui ? <ui.Markdown text={text} /> : <Text>{text}</Text>}
        </Box>
      )
    }

    // A teammate's message: "Message from <portrait> Name" above its own bubble; any other note is a dim centred line.
    const teammateNote = (key: string, text: string) => {
      const found = /^(?:From (.+?): |(.+?) replied: )([\s\S]*)$/.exec(shown(text))
      const sender = found === null ? undefined : team.agents.find(one => one.name === (found[1] ?? found[2]))
      if (found === null || sender === undefined) {
        return (
          <Box key={key} alignSelf="center" marginTop={1}>
            <Text color={CARD.secondary}>{shown(text)}</Text>
          </Box>
        )
      }

      return (
        <Box key={key} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1} alignItems="center" alignSelf="flex-end">
            <Text color={CARD.secondary}>Message from</Text>
            {isGraphic && 'Svg' in ui && <ui.Svg source={portraitSvg(sender, sender.status)} alt={`${sender.name} portrait`} width={18} height={18} />}
            <Text color={CARD.secondary}>{sender.name}</Text>
          </Box>
          {bubble(`${key}-text`, false, found[3] ?? '', true)}
        </Box>
      )
    }

    // The conversation as a chat: the agent's centred pill (portrait and name), every message oldest first, then the
    // composer at the bottom. The pane overflows and scrolls natively (wheel and trackpad). The host has no sticky or
    // fixed position and no element that scrolls on its own (Box takes position relative|absolute, overflow
    // visible|hidden), so the pill and the composer scroll with the history rather than staying put.
    const conversation = () => {
      if (agent === undefined) return null
      const id = agent.id
      const composerBase = `compose:${id}`

      // Filled, the chat takes its area less 8% at each side (the mock's history padding); narrow, it takes the pane.
      const column = isWide ? Math.max(30, Math.round(chatColumns * 0.84)) : undefined
      const chatRows = toRows(team.chats[id] ?? [], now)
      const drawRow = (row: (typeof chatRows)[number]) =>
        row.kind === 'day' ? (
          <Box key={row.key} alignSelf="center" marginTop={1} flexShrink={0}>
            <Text color={CARD.secondary}>{row.text}</Text>
          </Box>
        ) : row.kind === 'note' ? (
          teammateNote(row.key, row.text)
        ) : (
          bubble(row.key, row.line.from === 'you', shown(row.line.text), row.line.from === 'agent')
        )
      // Each row's estimated height: its gap, its bubble's frame and its words wrapped at the bubble's width.
      const textWidth = (text: string) => Math.min(bubbleCap ?? (column ?? 60), Math.max(0, ...text.split('\n').map(line => Array.from(line).length)) + 4) - 4
      const heights = chatRows.map(row =>
        row.kind === 'day' ? 2 : row.kind === 'note' ? 4 + wrappedRows(shown(row.text), textWidth(shown(row.text))) : 3 + wrappedRows(shown(row.line.text), textWidth(shown(row.line.text))),
      )
      // The window's rows, estimated (the pill, composer and bar take the rest); used only to stop at the oldest end.
      const viewRows = Math.max(5, (paneRows ?? 30) - 16)
      const back = isOwnScroll ? Math.min(backNow[id] ?? 0, Math.max(0, heights.reduce((sum, rows) => sum + rows, 0) - viewRows)) : 0
      const window = historyWindow(heights, back, viewRows)
      filledChat = isOwnScroll ? { id, heights, viewRows } : undefined
      return (
        <Box key={`chat-${id}`} flexDirection="column" flexGrow={1} flexShrink={1} width={column ?? '100%'} alignSelf="center" overflow={isOwnScroll ? 'hidden' : undefined}>
          <Box
            key="profile"
            flexDirection="row"
            gap={1}
            alignItems="center"
            alignSelf="center"
            paddingX={1}
            borderStyle="round"
            borderColor={CARD.border}
            backgroundColor={isGraphic ? CARD.panel : undefined}
          >
            {isGraphic && 'Svg' in ui && (
              // The mock's 32px pill photo, in a box sized in cells to hold it.
              <Box key="pill-photo" width={PILL_PHOTO_BOX.columns} height={PILL_PHOTO_BOX.rows} flexShrink={0} alignItems="center" justifyContent="center">
                <ui.Svg source={portraitSvg(agent, agent.status)} alt={`${agent.name} portrait`} width={32} height={32} />
              </Box>
            )}
            <Text bold>{agent.name}</Text>
          </Box>
          {isOwnScroll ? (
            // The history's window: it takes what the pill, composer and bar leave, clipped; drawn from the bottom (the
            // oldest drawn message clipped at the top) until the oldest end, which is drawn from the top.
            <Box key="history" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" justifyContent={window.isAtTop ? 'flex-start' : 'flex-end'}>
              {chatRows.slice(window.start, window.end).map(drawRow)}
            </Box>
          ) : (
            <>
              {chatRows.map(drawRow)}
              <Box key="spacer" flexGrow={1} />
            </>
          )}
          {isOwnScroll && back > 0 && (
            <Box key="to-newest-row" flexDirection="row" justifyContent="center" flexShrink={0}>
              <Button key="to-newest" plain dimColor label="↓ Newest" onPress={() => update($, historyBack, all => ({ ...all, [id]: 0 }))} />
            </Box>
          )}
          {isDesktopClient && isClientUsable(composerBase) ? (
            // The desktop's Input keeps a fixed width; the plugin's own field spans the column.
            <Box key="composer" width="100%" marginTop={1}>
              <ui.Client key={clientKey(composerBase)} module="./composer.tsx" props={composerProps(id, agent.name)} width="100%" />
            </Box>
          ) : 'Input' in ui ? (
            <Box key="composer" width="100%" marginTop={1} flexDirection="column" alignItems="stretch">
              {/* The field shows this agent's own draft; it empties once a send has entered, and keeps the words if it did not. */}
              <ui.Input
                key={composerBase}
                value={draftsNow[id] ?? ''}
                placeholder={`Message ${agent.name}`}
                submitLabel="↑"
                onInput={value => update($, drafts, all => ({ ...all, [id]: value }))}
                onSubmit={async value => {
                  // A repeated Enter while this agent's send waits is ignored: the words stay, nothing goes twice.
                  if (sending[id]) {
                    await update($, drafts, all => ({ ...all, [id]: value }))
                    return
                  }
                  await update($, drafts, all => ({ ...all, [id]: value }))
                  const outcome = await sendGuarded($, id, value)
                  // Taken: the field empties only if it still holds the words sent. Refused: what is there stays.
                  await update($, drafts, all => draftAfterSend(all, id, value, outcome.isSent))
                  await update($, sendErrors, all => errorAfter(all, id, value, outcome))
                }}
              />
            </Box>
          ) : (
            <Text color={CARD.secondary}>This surface has no text field.</Text>
          )}
          {errorsNow[id] !== undefined && (
            <Text key="send-error" color="red">
              {`Not sent: ${errorsNow[id]} Your message is still in the box.`}
            </Text>
          )}
        </Box>
      )
    }
    // Filled, the picked agent's chat is on screen: the session's timer clears its unread count.
    isFilled = isWide
    const shownAgent = isWide && !isManagingNow ? agent : undefined
    seenUnread = shownAgent !== undefined && unreadOf(shownAgent) > 0 ? shownAgent.id : undefined
    needsTop = isOwnScroll && (e.props.scroll?.offset ?? 0) > 0
    // Filled with a chat, the screen is exactly the pane's height: the pill at the top, the history's window between,
    // the composer and the bar at the bottom, and only the history moves (see the `ui.scroll` hook). Filled with
    // Edit agents, it is at least the pane's height and scrolls natively; tiled, the list scrolls natively.
    const screen = (
      <Box
        key="screen"
        flexDirection="column"
        gap={1}
        width={width}
        height={isOwnScroll ? paneRows : undefined}
        minHeight={isWide && !isOwnScroll ? paneRows : undefined}
        overflow={isOwnScroll ? 'hidden' : undefined}
      >
        {!isWide && list}
        {/* Filled: the chat (or Edit agents) full width above the agent bar. On the terminal a frame divides them.
            Tiled (narrow), the pane is the list alone: chats open in the filled pane. Edit agents still shows when asked for. */}
        {(isWide || isManagingNow) && (
          <Box key="chat-frame" flexDirection="column" flexGrow={1} borderStyle={isGraphic ? undefined : 'single'} borderDimColor paddingX={1}>
            {isManagingNow ? managing : conversation()}
          </Box>
        )}
        {isWide && bar}
      </Box>
    )
    // Filled with a chat: the screen, then an empty runway below it. A pane that fits its screen gives the desktop
    // nothing to scroll, and then it raises no wheel event at all (v0.1.54); the runway gives it room, so the wheel
    // raises `ui.scroll`, which the hook denies (and, should the desktop move anyway, snaps the pane back to the top).
    return isOwnScroll ? (
      <Box flexDirection="column" width={width}>
        {screen}
        <Box key="runway" height={Math.max(3, Math.round((paneRows ?? 30) / 2))} />
      </Box>
    ) : (
      screen
    )
  }).catch(($, e, next) => {
    const { Text } = $.ui.resolve(e)
    return <Text color="red">agents could not draw the inbox ({next.error?.kind}): {next.error?.message ?? 'no message'}</Text>
  })


  // The person's wheel over the filled pane moves the chat's history, not the pane: the move is denied, and the
  // history's window moves by its rows instead. A tick moves three rows, a page key or fling as far as it asks (see
  // wheelRows). Should the desktop have moved the pane regardless, it is put back at the top. Tiled and Edit agents
  // scroll natively.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const chat = filledChat
    if (chat === undefined || e.origin.kind !== 'person') return next(e)
    await update($, historyBack, all => ({ ...all, [chat.id]: scrolledBack(all[chat.id] ?? 0, e.by, chat.heights, chat.viewRows) }))
    if (e.offset !== 0) void $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
    return {}
  }).catch(($, e, next) => next(e))

  // A Client that failed is drawn again under a fresh key, a few times; then its site uses the surface's own control.
  on('ui.fault', async ($, e, next) => {
    const base = clientBase(e.element)
    if (base.startsWith('pick:') || base.startsWith('compose:')) {
      clientGen[base] = (clientGen[base] ?? 0) + 1
      $.ui.invalidate('ui.render')
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Above the message box: no picker, only a way back to the inbox while it is closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const team: Roster = await read($, roster)
    if (team.agents.length === 0 || (await read($, isPaneOpen))) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const unread = team.agents.reduce((sum, one) => sum + unreadOf(one), 0)

    return (
      <Box flexDirection="row">
        <Button key="inbox" plain dimColor label={unread > 0 ? `Open Agents inbox (${unread} new)` : 'Open Agents inbox'} onPress={() => openInbox($)} />
      </Box>
    )
  })

  // The handover row the inbox or a teammate puts in Claude's chat: one short line naming the agent, drawn as this
  // plugin's own tree (the path the work card proves the desktop draws). The stored message is untouched; the
  // terminal's ctrl+o still shows it all. Each sighting is recorded in the store under `renderSeen` (the last 10),
  // so a live run says whether the surface raised the row at all and what it was handed.
  const FRAME = 'The agents plugin sent a message:'
  const OLD_FRAME = 'The agent-mode plugin sent a message:'
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const origin = e.props.origin
    const isOurs = (origin.kind === 'plugin' && (origin.name === 'agents' || origin.name === 'agent-mode')) || e.props.text.trimStart().startsWith(FRAME) || e.props.text.trimStart().startsWith(OLD_FRAME)
    const name = isOurs ? handoverTarget(e.props.text) : undefined
    const isPassed = name === undefined || (e.props.isExpanded && e.surface === 'terminal')
    if (isOurs) {
      const sighting = {
        at: await $.clock.now(),
        surface: e.surface,
        requestId: e.requestId,
        origin,
        isExpanded: e.props.isExpanded,
        head: e.props.text.slice(0, 80),
        drew: isPassed ? 'engine' : 'line',
      }
      void $.store
        .get('renderSeen')
        .then(seen => $.store.set('renderSeen', [...(Array.isArray(seen) ? seen : []), sighting].slice(-10)))
        .catch(() => undefined)
    }
    if (isPassed) return next(e)
    const { Text } = $.ui.resolve(e)
    const label = e.props.text.includes('answered in the Agents inbox') ? `Sent to ${name} from the Agents inbox` : `Agent mode handed a message to ${name}`

    return <Text color={CARD.secondary}>{label}</Text>
  }).catch(($, e, next) => next(e))

  // Claude starting a panel agent: its loop joins the agent, and its card in Claude's reply gets a run to show.
  on('agent.spawn', async ($, e, next) => {
    const id = e.description.startsWith(AGENT_PREFIX) ? panelFor(await read($, roster), e.description) : undefined
    const started = await next(e)
    if (id !== undefined && started.deny === undefined && started.agentId !== undefined) {
      const loop = started.agentId
      const at = await $.clock.now()
      await update($, runs, all => ({ ...all, [loop]: id }))
      await update($, history, all => startRun(all, loop, id, at))
      await update($, cards, all => ({ ...all, [e.tool_use_id]: loop }))
      await update($, roster, all => setStatus(all, id, 'thinking'))
      // A teammate request handed to Claude to start this agent belongs to the loop just started.
      await update($, asks, all => bindAskLoop(all, id, loop))
    }

    return started
  }).catch(($, e, next) => next(e))

  // Status, usage and steps: a panel agent's tool call makes it acting until its last call ends.
  on('tool.call', async ($, e, next) => {
    const loop = e.agentId
    if (loop === undefined || e.tool === PROFILE_TOOL || e.tool === ADD_TOOL || e.tool === BRIEF_TOOL) return next(e)
    const id = await panelOf($, loop)
    if (id === undefined) return next(e)
    const at = await $.clock.now()
    await update($, history, all => addStep(all, loop, stepText(e.tool, e as unknown as Record<string, unknown>), at))
    if (e.tool === MESSAGE_TOOL) return next(e)
    acting[loop] = (acting[loop] ?? 0) + 1
    await update($, roster, all => addUsage(setStatus(all, id, 'acting'), id, { tools: 1 }))
    try {
      return await next(e)
    } finally {
      const left = (acting[loop] ?? 1) - 1
      acting[loop] = left
      if (left <= 0) {
        delete acting[loop]
        await update($, roster, all => (all.agents.find(one => one.id === id)?.status === 'acting' ? setStatus(all, id, 'thinking') : all))
      }
    }
  }).catch(($, e, next) => next(e))

  // The agent's own briefing, kept from the handover that started it (rebuilt from the roster if none is kept).
  on('tool.call', { tool: BRIEF_TOOL }, async ($, e) => {
    const id = e.agentId === undefined ? undefined : await panelOf($, e.agentId)
    if (id === undefined) return { deny: 'get_briefing is only for Agent mode team members.' }

    return { result: (await read($, briefs))[id] ?? intro(await read($, roster), id) }
  }).catch(() => ({ deny: 'get_briefing failed.' }))

  on('tool.call', { tool: PROFILE_TOOL }, async ($, e) => {
    const id = e.agentId === undefined ? undefined : await panelOf($, e.agentId)
    if (id === undefined) return { deny: 'update_my_profile is only for Agent mode team members.' }
    const now = await $.clock.now()
    const change = readProfileChange(e as unknown as Record<string, unknown>)
    const check = applyProfile(await read($, roster), id, change)
    if (check.error !== undefined) return { result: `Nothing changed: ${check.error}` }
    await save($, all => {
      const outcome = applyProfile(all, id, change)

      return outcome.notes.reduce((acc, note) => noteLine(acc, id, note, now), outcome.roster)
    })
    const restart = check.isModelChanged ? ' The new model takes over from the next start, with this chat carried over.' : ''

    return { result: `${check.notes.join('. ') || 'Nothing changed'}.${restart}` }
  }).catch(() => ({ deny: 'update_my_profile failed.' }))

  // Claude adds a team member when the person asks.
  on('tool.call', { tool: ADD_TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'add_agent is for the main Claude chat only.' }
    const now = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    const check = addMember(await read($, roster), input, now)
    if (check.error !== undefined) return { result: `Not added: ${check.error}` }
    const saved = await save($, all => addMember(all, input, now).roster)
    await stockPhoto($, saved.agents.at(-1)?.id)
    const agent = saved.agents[saved.agents.length - 1]

    return {
      result: `Added ${agent?.name ?? 'the agent'} (${agent?.title ?? ''}, ${agent?.team ?? ''} team). Start it with the Agent tool: name "${handleOf(agent?.name ?? '')}", description "${AGENT_PREFIX}${agent?.name ?? ''}".`,
    }
  }).catch(() => ({ deny: 'add_agent failed.' }))


  // The desktop composer posts its words as they change, a send on Enter or the arrow, and copies.
  on('ui.message', async ($, e) => {
    // A press anywhere on an agent's card in the list (rowpick.tsx).
    const element = clientBase(e.element)
    // The list's search box: its words narrow the list as they are typed.
    if (element === 'search:list') {
      const posted = (typeof e.data === 'object' && e.data !== null ? e.data : {}) as { draft?: unknown }
      if (typeof posted.draft === 'string') {
        clientDrafts[element] = posted.draft
        await update($, listFilter, () => posted.draft as string)
      }
      return {}
    }
    if (element.startsWith('pick:')) {
      // `pick:<agent id>` over a row's preview line, `:name` over its name, `:gap` over the rest of the name line.
      await pickAgent($, element.slice('pick:'.length).replace(/:(face|text|name|gap)$/, ''))
      return {}
    }
    // A name or title field (`rename:<id>`, `retitle:<id>` in Edit agents; `relabel:<id>`, Rename from the ⋯ menu):
    // the same posts as the composer; a send saves. A saved Rename closes its field.
    const fieldMatch = /^(rename|retitle|relabel):(.+)$/.exec(element)
    if (fieldMatch !== null) {
      const kind = fieldMatch[1] === 'retitle' ? 'title' : 'name'
      const agentId = fieldMatch[2] ?? ''
      const posted = (typeof e.data === 'object' && e.data !== null ? e.data : {}) as { draft?: unknown; send?: unknown }
      if (typeof posted.draft === 'string') clientDrafts[element] = posted.draft
      const asked = asSeqText(posted.send)
      if (asked === undefined || asked.seq <= (clientSeq[element] ?? 0)) return {}
      clientSeq[element] = asked.seq
      const isSaved = await saveField($, agentId, kind, asked.text)
      if (isSaved && fieldMatch[1] === 'relabel') await update($, renaming, () => null)
      clientResolved[element] = { seq: asked.seq, isSent: isSaved }
      Object.assign(clientDrafts, draftAfterSend(clientDrafts, element, asked.text, isSaved))
      const agentNow = (await read($, roster)).agents.find(one => one.id === agentId)

      return {
        props: {
          draft: clientDrafts[element] ?? '',
          placeholder: (kind === 'name' ? agentNow?.name : agentNow?.title) || 'No title',
          sending: null,
          resolved: clientResolved[element],
          lastSeq: clientSeq[element],
          glyph: '✓',
        },
      }
    }
    if (!element.startsWith('compose:')) return {}
    const id = element.slice('compose:'.length)
    const name = (await read($, roster)).agents.find(one => one.id === id)?.name ?? ''
    // Every post carries the whole picture (words, the send waiting, the last copy), since a later post in the
    // same frame replaces an earlier one: nothing the composer asked for is lost to that.
    const data = (typeof e.data === 'object' && e.data !== null ? e.data : {}) as { draft?: unknown; send?: unknown; copy?: unknown }
    if (typeof data.draft === 'string') clientDrafts[id] = data.draft
    const copy = asSeqText(data.copy)
    if (copy !== undefined && copy.seq > (clientCopied[id] ?? 0)) {
      clientCopied[id] = copy.seq
      await $.ui.copy({ text: copy.text, surface: e.surface }).catch(() => undefined)
    }
    const send = asSeqText(data.send)
    if (send === undefined || send.seq <= (clientSeq[id] ?? 0)) return {}
    clientSeq[id] = send.seq
    clientInflight[id] = send
    const outcome = await sendGuarded($, id, send.text)
    delete clientInflight[id]
    clientResolved[id] = { seq: send.seq, isSent: outcome.isSent }
    // Taken: the words sent leave the box unless the person has typed since. Refused: the box keeps them.
    Object.assign(clientDrafts, draftAfterSend(clientDrafts, id, send.text, outcome.isSent))
    await update($, sendErrors, all => errorAfter(all, id, send.text, outcome))

    return { props: composerProps(id, name) }
  }).catch(() => ({}))

  // Claude sets a member's photo from a file the person names.
  on('tool.call', { tool: PHOTO_TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'set_agent_photo is for the main Claude chat only.' }
    const input = e as unknown as { name?: unknown; path?: unknown }
    const name = typeof input.name === 'string' ? input.name : ''
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    let photo: string | undefined
    if (path !== '') {
      const type = photoType(path)
      if (type === undefined) return { result: 'Nothing changed: the photo must be a .png, .jpg or .webp file.' }
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      if (base64.length > PHOTO_MAX) return { result: 'Nothing changed: the photo is too big; resize it to about 96px square first.' }
      photo = `data:${type};base64,${base64}`
    }
    const check = setPhoto(await read($, roster), name, photo)
    if (check.error !== undefined) return { result: `Nothing changed: ${check.error}` }
    await save($, all => setPhoto(all, name, photo).roster)

    return { result: photo === undefined ? `${name} is back to the drawn face.` : `${name} now shows the photo.` }
  }).catch(() => ({ deny: 'set_agent_photo failed.' }))

  // Agent to agent: the message shows in both chats, reaches the teammate, and its reply comes back.
  on('tool.call', { tool: MESSAGE_TOOL }, async ($, e) => {
    const fromId = e.agentId === undefined ? undefined : await panelOf($, e.agentId)
    if (fromId === undefined) return { deny: 'message_teammate is only for Agent mode team members.' }
    const input = e as unknown as { to?: unknown; message?: unknown }
    const to = typeof input.to === 'string' ? input.to : ''
    const text = typeof input.message === 'string' ? input.message.trim() : ''
    const team = await read($, roster)
    const from = team.agents.find(one => one.id === fromId)
    const target = findTeammate(team, fromId, to)
    if (from === undefined || target === undefined) {
      const names = team.agents.filter(one => one.id !== fromId).map(one => one.name)
      return { result: `No teammate named "${to}". Teammates: ${names.join(', ') || 'none'}.` }
    }
    if (text === '') return { result: 'The message is empty.' }
    const now = await $.clock.now()
    await save($, all => noteLine(noteLine(all, fromId, `To ${target.name}: ${text}`, now), target.id, `From ${from.name}: ${text}`, now))
    // Queued behind any request already out with this teammate, and held while it works on something else,
    // so each answer goes back to the one request it answers.
    const ask: Ask = { id: `${target.id}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, from: fromId, fromName: from.name, text, isDelivered: false }
    const queued = await update($, asks, all => enqueueAsk(all, target.id, ask))
    const isFree = (await read($, roster)).agents.find(one => one.id === target.id)?.status === 'ready'
    if (askToDeliver(queued, target.id, isFree)?.id === ask.id) {
      await update($, asks, all => markAskSending(all, target.id, ask.id))
      outbox.push({ toId: target.id, incoming: { from: from.name, text, isReply: false }, askId: ask.id })
      return { result: `Sent to ${target.name}; they are started if stopped. Their reply will come back to you as a message.` }
    }

    return { result: `Queued for ${target.name}, who is busy; it goes to them when they finish. Their reply will come back to you as a message.` }
  }).catch(() => ({ result: 'message_teammate failed; the message was not sent.' }))

  // A panel agent's answer: into its history and its card; its loop has ended, so the next message starts it again.
  on('turn.complete', async ($, e, next) => {
    const loop = e.agentId
    if (loop === undefined) return next(e)
    const id = await panelOf($, loop)
    if (id === undefined) return next(e)
    const now = await $.clock.now()
    // Seen only if this agent's chat is on screen: picked, in the filled pane, with the pane open.
    const isSeen = (await read($, selected)) === id && isFilled && (await read($, isPaneOpen))
    const text = e.answer.trim() !== '' ? e.answer.trim() : e.isAborted ? '_Stopped._' : '_No reply._'
    const saved = await save($, all =>
      addUsage(replyLine(all, id, text, now, isSeen), id, {
        replies: 1,
        tokensIn: e.usage?.input_tokens ?? 0,
        tokensOut: e.usage?.output_tokens ?? 0,
      }),
    )
    await update($, history, all => endRun(all, loop, text, now))
    await update($, runs, all => Object.fromEntries(Object.entries(all).filter(([one]) => one !== loop)))
    delete acting[loop]

    // An answer goes back to the teammate request this loop was given, and only to it; then the next request goes out.
    let routed: ReturnType<typeof answerAsk> = { asks: {} }
    await update($, asks, all => {
      routed = answerAsk(all, id, loop)
      return routed.asks
    })
    if (routed.answered !== undefined) {
      const asker = routed.answered.from
      const replier = saved.agents.find(one => one.id === id)?.name ?? 'Your teammate'
      await save($, all => noteLine(all, asker, `${replier} replied: ${text}`, now))
      outbox.push({ toId: asker, incoming: { from: replier, text, isReply: true } })
    }
    if (routed.next !== undefined) {
      const waiting = routed.next
      await update($, asks, all => markAskSending(all, id, waiting.id))
      outbox.push({ toId: id, incoming: { from: waiting.fromName, text: waiting.text, isReply: false }, askId: waiting.id })
    }

    return next(e)
  })

  // A panel agent's Agent-tool row in Claude's reply: its face, name, state, steps and answer.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== AGENT_TOOL) return next(e)
    const input = (e.props.input ?? {}) as { description?: unknown }
    const description = typeof input.description === 'string' ? input.description : ''
    if (!description.startsWith(AGENT_PREFIX)) return next(e)
    const team: Roster = await read($, roster)
    const id = panelFor(team, description)
    const agent = team.agents.find(one => one.id === id)
    if (agent === undefined) return next(e)
    const loop = (await read($, cards))[e.props.tool_use_id]
    const run = loop === undefined ? undefined : (await read($, history))[loop]
    const isDone = run === undefined ? !e.props.isRunning : run.endedAt !== undefined
    const state = e.props.isErrored ? 'Failed' : e.props.isInterrupted ? 'Stopped' : isDone ? 'Done' : 'Working…'
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const isGraphic = e.surface !== 'terminal' && 'Svg' in ui
    const callId = e.props.tool_use_id
    // Folded by default: the answer itself is in Claude's reply, so the card only summarises it.
    const isOpen = (await read($, expanded))[callId] === true
    const steps = run?.steps ?? []
    const answer = run?.answer
    const report = answer === undefined ? undefined : reportOf(answer)
    const latest = steps.at(-1)

    const toggle = () =>
      update($, expanded, all => {
        const changed = { ...all }
        if (changed[callId] === true) delete changed[callId]
        else changed[callId] = true
        return changed
      })

    const saveReport = async () => {
      if (answer === undefined) return
      const path = reportPath(await $.session.cwd(), agent.name, run?.endedAt ?? (await $.clock.now()))
      try {
        await $.fs.write(path, `# ${agent.name} report\n\n${answer}\n`)
        $.ui.toast(`Saved ${agent.name}'s report to ${path}`)
      } catch (error) {
        $.ui.toast(`Could not save the report: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={CARD.border} paddingX={1}>
        <Box key="head" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {isGraphic && 'Svg' in ui && <ui.Svg source={portraitSvg(agent, isDone ? 'ready' : agent.status)} alt="" width={20} height={20} />}
          <Text bold>{agent.name}</Text>
          <Text color={state === 'Done' ? CARD.done : state === 'Working…' ? CARD.working : CARD.secondary}>{state}</Text>
          {report !== undefined && <Text color={CARD.secondary}>· {report.title}</Text>}
          {(steps.length > 0 || answer !== undefined) && (
            <Button key={`details:${callId}`} plain dimColor label={isOpen ? 'Hide details' : 'Show details'} onPress={toggle} />
          )}
        </Box>
        {!isOpen && !isDone && latest !== undefined && (
          <Text key="now" color={CARD.secondary}>
            {latest.text}
          </Text>
        )}
        {isOpen &&
          steps.map((step, index) => (
            <Box key={`step-${index}`} flexDirection="row" gap={1}>
              <Text color={CARD.secondary}>{clock(step.at)}</Text>
              <Text>{step.text}</Text>
            </Box>
          ))}
        {isOpen && report !== undefined && (
          <Box key="report" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <Text color={CARD.secondary}>
              Report: {report.words} words · {report.lines} lines
            </Text>
            <Button key={`save:${callId}`} plain label="Save .md" onPress={saveReport} />
            <Button key={`copy:${callId}`} plain label="Copy" onPress={press => $.ui.copy({ text: answer ?? '', surface: press.surface })} />
          </Box>
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
