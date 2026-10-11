import { expect, test } from 'claude-code/testing'
import { noteLine, sendLine } from '../hooks/model'
import { BAND, ID1, ID2, NOW, PANE, SURFACES, briefing, canOpen, claudeStarts, complete, editAgents, field, inChat, many, openAgent, start, two, typeInto, typed, world } from './world'

test('Edit agents, behind +, adds agents and teams, changes models, renames, pins and deletes with a second press', async ($, on) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Everyday rows carry no management controls.
    expect(await ui.find({ key: `model:${ID1}` })).toBeUndefined()
    await editAgents(ui)
    await ui.press({ key: 'add:Team' })
    await ui.input({ key: 'new-team', text: 'Research' })
    expect(await ui.find({ key: 'add:Research' })).toBeDefined()
    await ui.press({ key: 'delete-team:Research' })
    expect(await ui.find({ key: 'add:Research' })).toBeUndefined()
    await ui.press({ key: 'done' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await editAgents(ui)
  // Each agent's controls sit behind its own Edit button.
  expect(await ui.find({ key: `model:${ID2}` })).toBeUndefined()
  await ui.press({ key: `edit:${ID2}` })
  await ui.select({ key: `model:${ID2}`, value: 'opus' })
  expect(await ui.find({ key: `model:${ID2}`, value: 'opus' } as never)).toBeDefined()
  await typeInto(ui, `rename:${ID2}`, 'Writer')
  await ui.press({ key: `pin:${ID2}` })
  expect(await ui.find({ key: `pin:${ID2}`, text: /Unpin/ } as never)).toBeDefined()
  await typeInto(ui, `retitle:${ID2}`, 'Copywriter')
  expect(await ui.find({ text: /Copywriter · Team · opus/ })).toBeDefined()
  // Delete is apart from the everyday fields and asks twice.
  expect(await ui.find({ key: `delete:${ID2}`, text: /Delete agent/ } as never)).toBeDefined()
  await ui.press({ key: `delete:${ID2}` })
  expect(await ui.find({ text: /Delete Writer and its chat\? Press again/ })).toBeDefined()
  await ui.press({ key: `delete:${ID2}` })
  expect(await canOpen(ui, ID2)).toBe(false)
})

test('the inbox reopens only if it was left open; while closed, the band offers to open it and picks nobody', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(seen.opens).toHaveLength(0)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'pick:claude' })).toBeUndefined()
  await band.press({ key: 'inbox' })
  expect(seen.opens).toEqual(['agent-mode'])
  expect(await band.find({ key: 'inbox' })).toBeUndefined()
  expect(await band.find({ text: /engine AbovePrompt/ })).toBeDefined()
})

test('a saved open inbox opens again at session start', async ($, on) => {
  const seen = world(on, two(), true)
  await start($)
  expect(seen.opens).toEqual(['agent-mode'])
})

test('the inbox lists agents by team and keeps each conversation to its own agent', async ($, on) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // The filled pane's bottom bar has no group headings; the tiled list keeps them, in small capitals.
    expect(await ui.find({ text: /^TEAM$/ })).toBeUndefined()
    expect(await canOpen(ui, ID1)).toBe(true)
    expect(await canOpen(ui, ID2)).toBe(true)
    // The first agent is open until the person picks another.
    expect(await ui.find({ key: `compose:${ID1}` })).toBeDefined()
    expect(await ui.find({ text: /^Hi, I'm Agent 1\. Tell me what you need and I'll get started\.$/ })).toBeDefined()
    expect(await ui.find({ text: /^Hi, I'm Agent 2\. Tell me what you need and I'll get started\.$/ })).toBeUndefined()
    // The conversation opens with the agent's name alone, no role, team or scope text.
    expect(await ui.find({ key: 'profile', text: /^Agent 1$/ } as never)).toBeDefined()
    expect(await ui.find({ text: /Agent mode history since|Generalist · Team team/ })).toBeUndefined()
    await openAgent(ui, ID2)
    expect(await ui.find({ key: `compose:${ID2}` })).toBeDefined()
    expect(await ui.find({ key: `compose:${ID1}` })).toBeUndefined()
    expect(await ui.find({ text: /^Hi, I'm Agent 2\. Tell me what you need and I'll get started\.$/ })).toBeDefined()
    expect(await ui.find({ text: /^Hi, I'm Agent 1\. Tell me what you need and I'll get started\.$/ })).toBeUndefined()
    await openAgent(ui, ID1)
    await ui.unmount()
  }
})

test('sending from the inbox reaches the agent it was written to, even after the pick moves; working, then the reply in its own chat', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: `compose:${ID1}`, text: 'Audit the homepage' })
  const handover = seen.prompts.at(-1)!.text
  expect(handover).toContain('Call the Agent tool once with name "agent-1", description "Team member: Agent 1"')
  expect(handover).toContain('"Agent 1 answered in the Agents inbox."')
  // The handover Claude's chat shows is a few lines; the history and the message wait in the briefing.
  expect(handover.split('\n').length).toBeLessThanOrEqual(5)
  expect(handover).not.toContain('The chat so far')
  expect(handover).toContain('call get_briefing (mcp__agent-mode__get_briefing)')
  expect(await ui.find({ text: /^Audit the homepage$/ })).toBeDefined()

  // The person moves to Agent 2 while Agent 1 works.
  await openAgent(ui, ID2)
  await claudeStarts($, 'Agent 1')
  const brief = await briefing($, 'loop-1')
  expect(brief).toContain('You are Agent 1, Generalist in the Team team of Agent mode')
  expect(brief).toContain("The person's message to answer now:\nAudit the homepage")
  expect(brief).toContain('- Agent 2 (Generalist, Team team)')
  // The list names each agent on its button, with no status words (the desktop puts a dot on the photo).
  expect(await ui.findAll({ type: 'Button', text: /^Agent \d$/ } as never)).toHaveLength(2)
  expect(await ui.find({ text: /^Working$/ })).toBeUndefined()
  expect(await ui.find({ text: /^Waiting/ })).toBeUndefined()
  // Agent 2's chat is open: Agent 1's message shows only as its list preview.
  expect(await inChat(ui, /^Audit the homepage$/)).toHaveLength(0)

  await openAgent(ui, ID1)
  expect(await ui.find({ text: /^● |^○ Idle$/ })).toBeUndefined()
  await ui.input({ key: `compose:${ID1}`, text: 'Start with the title tag' })
  expect(seen.prompts.at(-1)!.text).toContain('Call SendMessage with to "agent-1"')

  await $.turn.complete(complete('loop-1', 'The title tag is missing.'))
  // In the chat, not the list's one-line preview.
  expect(await inChat(ui, /^The title tag is missing\.$/)).not.toHaveLength(0)
  await openAgent(ui, ID2)
  expect(await inChat(ui, /^The title tag is missing\.$/)).toHaveLength(0)
})

test('the composer empties as soon as a send enters, keeps the words when it is refused, and keeps each agent its own draft', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // Drafts are per agent and survive switching.
  await ui.input({ key: `compose:${ID1}`, text: 'Draft for one', kind: 'change' })
  await openAgent(ui, ID2)
  expect(await field(ui, ID2)).toBe('')
  await ui.input({ key: `compose:${ID2}`, text: 'Draft for two', kind: 'change' })
  await openAgent(ui, ID1)
  expect(await field(ui, ID1)).toBe('Draft for one')

  // Refused: nothing sent, no line, the agent stays idle, the words stay with the reason shown.
  seen.drop = 'Blocked for the test.'
  await ui.input({ key: `compose:${ID1}`, text: 'Audit the homepage' })
  expect(seen.prompts).toHaveLength(0)
  expect(await field(ui, ID1)).toBe('Audit the homepage')
  expect(await ui.find({ text: /Not sent: Blocked for the test\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Audit the homepage$/ } as never)).toBeUndefined()

  // Accepted: the handover enters once, the field is empty at once, the error is gone.
  seen.drop = undefined
  await ui.input({ key: `compose:${ID1}`, text: 'Audit the homepage' })
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]!.text).toContain('name "agent-1"')
  expect(await field(ui, ID1)).toBe('')
  expect(await ui.find({ text: /Not sent/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Audit the homepage$/ } as never)).toBeDefined()

  // The other agent's draft was never touched.
  await openAgent(ui, ID2)
  expect(await field(ui, ID2)).toBe('Draft for two')
})

test('chat bubbles as in the mock: the agent\'s outlined soft grey on the left, the person\'s outlined unfilled on the right, at most 70% wide', async ($, on) => {
  const long = 'word '.repeat(60).trim()
  world(on, sendLine(sendLine(two(), ID1, 'Check the sitemap', NOW - 60_000), ID1, long, NOW - 50_000))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: { width?: unknown; alignSelf?: string; backgroundColor?: string; borderColor?: string }; text?: string }[]
  const bubbles = boxes.filter(one => one.props.borderColor === '#8a8f9859' && (one.props.alignSelf === 'flex-start' || one.props.alignSelf === 'flex-end'))
  // Oldest first: the agent's greeting, then the person's two messages below it.
  expect(bubbles.map(one => [one.props.alignSelf, one.props.backgroundColor])).toEqual([
    ['flex-start', '#8a8f9826'],
    ['flex-end', undefined],
    ['flex-end', undefined],
  ])
  // Short words keep their own width; the long one takes 70% of the full-width chat column (100 * 0.84 = 84 → 58).
  expect(bubbles[1]?.props.width).toBeUndefined()
  expect(bubbles[2]?.props.width).toBe(58)
  expect(boxes.find(one => one.props.alignSelf === 'center' && one.text?.startsWith('Hi'))).toBeUndefined()
})

test('the main message box always talks to Claude', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openAgent(ui, ID2)
  await typed($, 'Hello Claude')
  expect(seen.prompts.at(-1)!).toEqual({ text: 'Hello Claude', context: [] })
})

test('saved history comes back in its bubbles, and a teammate\'s message carries a "Message from" label', async ($, on) => {
  const saved = noteLine(sendLine(two(), ID1, 'Check the sitemap', NOW - 60_000), ID1, 'From Agent 2: Sitemap has 3 broken URLs.', NOW - 30_000)
  world(on, saved)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: { width?: unknown; alignSelf?: string }; text?: string }[]
  const mine = (boxes as { props: { alignSelf?: string; borderColor?: string }; text?: string }[]).find(one => one.props.borderColor === '#8a8f9859' && one.props.alignSelf === 'flex-end')
  expect(mine?.text).toContain('Check the sitemap')
  // No name or time line inside the bubbles.
  expect(await ui.find({ text: /^You$/ })).toBeUndefined()
  expect(await ui.find({ text: /^Message from$/ })).toBeDefined()
  expect(await ui.find({ text: /Sitemap has 3 broken URLs\./ })).toBeDefined()
})

test('8 agents draw every agent at any width; the composer only in the wide layout', async ($, on) => {
  world(on, many(8))
  await start($)
  for (const bodyColumns of [100, 40]) {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
      const ids = many(8).agents.map(one => one.id)
      expect((await Promise.all(ids.map(id => canOpen(ui, id)))).every(Boolean)).toBe(true)
      const composer = (await ui.find({ key: `compose:${ids[0]}` } as never)) ?? undefined
      expect(composer !== undefined).toBe(bodyColumns === 100)
      await ui.unmount()
    }
  }
})
