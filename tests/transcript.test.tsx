import { expect, test } from 'claude-code/testing'
import { clock } from '../hooks/model'
import { handover } from '../hooks/relay'
import { ADD, BRIEF, ID1, LIVE_WRAPPED, MESSAGE, NOW, PANE, PROFILE, SURFACES, briefing, card, claudeStarts, complete, editAgents, row, start, two, world } from './world'

test("the handover row in Claude's chat shows one line naming the agent", async ($, on) => {
  world(on)
  await start($)
  const text = handover(two(), ID1, false, '', 'inbox')
  const row = await $.ui.mount({
    plugin: 'agents',
    component: 'UserMessage',
    props: { text, origin: { kind: 'plugin', name: 'agents' }, isExpanded: false } as never,
    surface: 'desktop',
  })
  expect(await row.find({ text: /Sent to Agent 1 from the Agents inbox/ })).toBeDefined()
})

test('the live wrapped handover row collapses to one line; unrelated rows and the terminal expanded view do not', async ($, on) => {
  world(on)
  await start($)
  const mine = { kind: 'plugin', name: 'agents' }
  for (const isExpanded of [false, true]) {
    const shownRow = await $.ui.mount(row(LIVE_WRAPPED, mine, isExpanded, 'desktop'))
    expect(await shownRow.find({ text: /^Sent to Builder from the Agents inbox$/ })).toBeDefined()
    expect(await shownRow.find({ text: /Call the Agent tool/ })).toBeUndefined()
    await shownRow.unmount()
  }
  const folded = await $.ui.mount(row(LIVE_WRAPPED, mine, false, 'terminal'))
  expect(await folded.find({ text: /^Sent to Builder from the Agents inbox$/ })).toBeDefined()
  await folded.unmount()
  // The host's frame alone marks the row as this plugin's, whatever origin the surface reports.
  const framed = await $.ui.mount(row(LIVE_WRAPPED, { kind: 'unclassified' }, true, 'desktop'))
  expect(await framed.find({ text: /^Sent to Builder from the Agents inbox$/ })).toBeDefined()
  expect(await framed.find({ text: /engine UserMessage|Call the Agent tool/ })).toBeUndefined()
  await framed.unmount()
  // ctrl+o on the terminal shows the whole stored message.
  const full = await $.ui.mount(row(LIVE_WRAPPED, mine, true, 'terminal'))
  expect(await full.find({ text: /Call the Agent tool/ })).toBeDefined()
  await full.unmount()
  // The person's own words, another plugin's message, or this plugin's other messages are left as they are.
  for (const [text, origin] of [
    [LIVE_WRAPPED.replace('The agent-mode plugin sent a message:\n', ''), { kind: 'composer' }],
    [LIVE_WRAPPED.replace('The agent-mode plugin sent a message:\n', ''), { kind: 'plugin', name: 'other-mod' }],
    ['The agent-mode plugin sent a message:\nSomething else', mine],
  ] as const) {
    const other = await $.ui.mount(row(text, origin, false, 'desktop'))
    expect(await other.find({ text: /Sent to/ })).toBeUndefined()
    await other.unmount()
  }
})

test('the work card starts folded, shows details on request, and never repeats the full answer', async ($, on) => {
  world(on)
  on('tool.call', ($, e) => ({ result: `ran ${e.tool}` }))
  const written: { path: string; text: string }[] = []
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  await start($)
  await claudeStarts($, 'Agent 1', 'toolu_a')
  await $.tool.call({ tool: 'Read', agentId: 'loop-1', file_path: '/site/index.html' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...card('toolu_a', 'Agent 1'), surface })
    expect(await ui.find({ text: /^Working…$/ })).toBeDefined()
    // Folded: the current step only, no timeline.
    expect(await ui.find({ text: clock(NOW) })).toBeUndefined()
    expect(await ui.find({ text: /^Reading index\.html$/ })).toBeDefined()
    await ui.press({ key: 'details:toolu_a' })
    expect(await ui.find({ key: 'details:toolu_a', text: /Hide details/ } as never)).toBeDefined()
    expect(await ui.find({ text: clock(NOW) })).toBeDefined()
    await ui.press({ key: 'details:toolu_a' })
    expect(await ui.find({ key: 'details:toolu_a', text: /Show details/ } as never)).toBeDefined()
    await ui.unmount()
  }
  await $.turn.complete(complete('loop-1', '## SEO check\nThe title tag is missing.'))
  const ui = await $.ui.mount({ ...card('toolu_a', 'Agent 1'), surface: 'desktop' })
  expect(await ui.find({ text: /^Done$/ })).toBeDefined()
  expect(await ui.find({ text: /SEO check/ })).toBeDefined()
  expect(await ui.find({ text: /Reading index\.html/ })).toBeUndefined()
  expect(await ui.find({ text: /The title tag is missing/ })).toBeUndefined()
  await ui.press({ key: 'details:toolu_a' })
  expect(await ui.find({ text: /7 words · 2 lines/ })).toBeDefined()
  expect(await ui.find({ text: /The title tag is missing/ })).toBeUndefined()
  await ui.press({ key: 'save:toolu_a' })
  expect(written).toHaveLength(1)
  expect(written[0]!.path).toBe('/work/agent-reports/agent-1-20261008-1200.md')
  expect(written[0]!.text).toContain('The title tag is missing.')
})

test('an agent changes its own profile; unknown models and outsiders are refused', async ($, on) => {
  world(on)
  await start($)
  await claudeStarts($, 'Agent 1')
  const changed = await $.tool.call({ tool: PROFILE, agentId: 'loop-1', name: 'Scout', title: 'SEO lead', team: 'Growth', model: 'opus' })
  expect(String(changed.result)).toContain('Agent 1 is now called Scout')
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ text: /^Scout$/ })).toBeDefined()
  await editAgents(pane)
  expect(await pane.find({ text: /^SEO lead · Growth · opus$/ })).toBeDefined()
  expect(await pane.find({ key: 'add:Growth' })).toBeDefined()

  const unknown = await $.tool.call({ tool: PROFILE, agentId: 'loop-1', model: 'gpt' })
  expect(String(unknown.result)).toContain('Unknown model')
  const outsider = await $.tool.call({ tool: PROFILE, name: 'Intruder' })
  expect(outsider.deny ?? outsider.text ?? '').toContain('only for Agent mode team members')
})

test('a message to a stopped teammate goes to Claude to start it; the reply reaches the running sender', async ($, on) => {
  const seen = world(on)
  await start($)
  await claudeStarts($, 'Agent 1')
  const sent = await $.tool.call({ tool: MESSAGE, agentId: 'loop-1', to: 'agent 2', message: 'Check the sitemap please' })
  expect(String(sent.result)).toContain('Sent to Agent 2')
  await seen.clock.advance(600)
  const relay = seen.prompts.at(-1)!.text
  expect(relay).toContain('Call the Agent tool once with name "agent-2"')
  expect(relay).toContain('call get_briefing')

  await claudeStarts($, 'Agent 2')
  const brief = await briefing($, 'loop-2')
  expect(brief).toContain('A message from your teammate Agent 1 to act on now')
  expect(brief).toContain('Check the sitemap please')
  expect(brief).toContain('do not message Agent 1 to answer it')
  await $.turn.complete(complete('loop-2', 'Sitemap has 3 broken URLs.'))
  await seen.clock.advance(600)
  expect(seen.appended).toContainEqual({ agentId: 'loop-1', text: 'Reply from your teammate Agent 2:\nSitemap has 3 broken URLs.' })
})

test('a reply to a sender that already stopped goes to Claude to start the sender with it', async ($, on) => {
  const seen = world(on)
  await start($)
  await claudeStarts($, 'Agent 1')
  await $.tool.call({ tool: MESSAGE, agentId: 'loop-1', to: 'Agent 2', message: 'Top 5 keywords?' })
  await seen.clock.advance(600)
  await claudeStarts($, 'Agent 2')
  await $.turn.complete(complete('loop-1', 'Asked Agent 2.'))
  await $.turn.complete(complete('loop-2', 'seo, audit, speed, schema, links'))
  await seen.clock.advance(600)

  const relay = seen.prompts.at(-1)!.text
  expect(relay).toContain('name "agent-1"')
  await claudeStarts($, 'Agent 1')
  const brief = await briefing($, 'loop-3')
  expect(brief).toContain('Your teammate Agent 2 replied to your message')
  expect(brief).toContain('seo, audit, speed, schema, links')
})

test('get_briefing is for team members only, and rebuilds a briefing when none was kept', async ($, on) => {
  world(on)
  await start($)
  const outsider = await $.tool.call({ tool: BRIEF } as never)
  expect(outsider.deny ?? '').toContain('only for Agent mode team members')
  await claudeStarts($, 'Agent 2')
  expect(await briefing($, 'loop-1')).toContain('You are Agent 2, Generalist in the Team team of Agent mode')
})

test('message_teammate refuses outsiders and unknown names', async ($, on) => {
  world(on)
  await start($)
  await claudeStarts($, 'Agent 1')
  const outsider = await $.tool.call({ tool: MESSAGE, to: 'Agent 2', message: 'hello' })
  expect(outsider.deny ?? '').toContain('only for Agent mode team members')
  const unknown = await $.tool.call({ tool: MESSAGE, agentId: 'loop-1', to: 'Nobody', message: 'hello' })
  expect(String(unknown.result)).toContain('Teammates: Agent 2')
})

test('main Claude adds a named team member; subagents cannot', async ($, on) => {
  world(on, null)
  await start($)
  const added = await $.tool.call({ tool: ADD, name: 'Scout', title: 'SEO lead', team: 'Growth', abilities: ['audits'] })
  expect(String(added.result)).toContain('Added Scout (SEO lead, Growth team)')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Button', text: /Scout/ })).toBeDefined()
  const twice = await $.tool.call({ tool: ADD, name: 'scout' })
  expect(String(twice.result)).toContain('already a team member')
  const fromAgent = await $.tool.call({ tool: ADD, agentId: 'loop-9', name: 'Rogue' })
  expect(fromAgent.deny ?? '').toContain('main Claude chat only')
})
