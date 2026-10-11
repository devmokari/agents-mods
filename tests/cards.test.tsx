import { expect, test } from 'claude-code/testing'
import { addAgent, appendLine, sendLine } from '../hooks/model'
import { ID1, ID2, MESSAGE, NOW, PANE, SURFACES, editAgents, canOpen, claudeStarts, complete, openAgent, portrait, start, two, typeInto, world } from './world'

test('/faces reports the version the manifest says', async ($, on) => {
  world(on)
  on('fs.read', ($, e) => (e.path.endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ name: 'agent-mode', version: '9.8.7' }) } : { value: '' }))
  await start($)
  const ran = await $.command.run({ command: 'faces', args: '' } as never)
  expect(JSON.stringify(ran)).toContain('Agents inbox opened (v9.8.7).')
})

test('a multi-screen reply is shown whole, with no cut or ellipsis, above the composer', async ($, on) => {
  const essay = Array.from({ length: 200 }, (_, n) => `row ${String(n + 1).padStart(3, '0')}`).join('\n')
  const saved = appendLine(sendLine(two(), ID1, 'Write the long report', NOW - 60_000), ID1, { id: 'essay', from: 'agent', text: essay, at: NOW - 30_000 })
  world(on, saved)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The shortest match is the reply itself; containers and the list's clipped preview are not it.
  const essayText = (await ui.findAll({ text: /row 001/ })).map(found => found.text ?? '').filter(text => text.includes('row 200')).sort((a, b) => a.length - b.length)[0]
  expect(essayText).toBeDefined()
  expect(essayText).not.toContain('…')
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.indexOf(`compose:${ID1}`)).toBeGreaterThan(drawn.indexOf('row 200'))
})

test('status is a dot on the photo, named in its description; the list has no status words', async ($, on) => {
  const seen = world(on, addAgent(two(), 'Team', NOW - 500))
  await start($)
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const words = async () => terminal.find({ text: /^Working$|^Waiting|request queued|^New$|^Generalist$/ } as never)
  expect(await words()).toBeUndefined()
  // Sent, not yet started by Claude: waiting to start. Started: working.
  await terminal.input({ key: `compose:${ID1}`, text: 'Audit the homepage' })
  expect((await portrait(desktop, 'Agent 1 portrait, Waiting to start'))?.props.source).toContain('fill="#f59e0b" stroke="#ffffff"')
  await claudeStarts($, 'Agent 1')
  expect((await portrait(desktop, 'Agent 1 portrait, Working'))?.props.source).toContain('fill="#2f6fed" stroke="#ffffff"')
  // Agent 1 asks Agent 3, who is free: Agent 1 waits on Agent 3 once its own turn is done.
  await $.tool.call({ tool: MESSAGE, agentId: 'loop-1', to: 'Agent 3', message: 'Check the sitemap' })
  await seen.clock.advance(600)
  await claudeStarts($, 'Agent 3')
  await openAgent(terminal, ID2)
  await $.turn.complete(complete('loop-1', 'Asked Agent 3.'))
  expect(await portrait(desktop, 'Agent 1 portrait, Waiting for Agent 3, 1 unread')).toBeDefined()
  expect((await portrait(desktop, 'Agent 3 portrait, Working'))?.props.source).toContain('fill="#2f6fed" stroke="#ffffff"')
  expect(await words()).toBeUndefined()
  await $.turn.complete(complete('loop-2', 'Sitemap fine.'))
  const idle = await portrait(desktop, 'Agent 3 portrait')
  expect(idle?.props.source).not.toContain('stroke="#ffffff" stroke-width="2"')
})

test('a request to a busy teammate shows on its photo: working, then queued, then waiting to start, then working', async ($, on) => {
  const seen = world(on, two(), true)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Agent 2 works on the person's task (loop-1); Agent 1 (loop-2) asks it something.
  await openAgent(ui, ID2)
  await ui.input({ key: `compose:${ID2}`, text: 'Write the meta descriptions' })
  await claudeStarts($, 'Agent 2')
  await claudeStarts($, 'Agent 1')
  await $.tool.call({ tool: MESSAGE, agentId: 'loop-2', to: 'Agent 2', message: 'Check the sitemap' })
  expect(await portrait(desktop, 'Agent 2 portrait, Working')).toBeDefined()
  // Agent 2 finishes the person's task: the request is next, queued until it goes out.
  await $.turn.complete(complete('loop-1', 'Meta descriptions written'))
  expect(await portrait(desktop, 'Agent 2 portrait, 1 request queued')).toBeDefined()
  await seen.clock.advance(600)
  expect(await portrait(desktop, 'Agent 2 portrait, Waiting to start')).toBeDefined()
  await claudeStarts($, 'Agent 2')
  expect(await portrait(desktop, 'Agent 2 portrait, Working')).toBeDefined()
})

test('list rows, WhatsApp style: portrait, name and the last message cut at 20 characters with "..."; no title', async ($, on) => {
  const longReply = 'This is a very long last message that goes on and on'
  world(on, appendLine(appendLine(two(), ID2, { id: 'r', from: 'agent', text: longReply, at: NOW - 1000 }), ID1, { id: 's', from: 'agent', text: 'Short reply', at: NOW - 900 }))
  await start($)
  for (const bodyColumns of [100, 40]) {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
      expect(await canOpen(ui, ID2)).toBe(true)
      // The kit cannot find a Text by key: the previews by their words, as Text nodes.
      const texts = ((await ui.findAll({ type: 'Text' } as never)) as { text?: string }[]).map(one => one.text)
      expect(texts).toContain('This is a very long...')
      expect(texts).toContain('Short reply')
      expect(await ui.find({ text: /^Generalist$/ })).toBeUndefined()
      expect(await ui.find({ text: /…/ })).toBeUndefined()
      // No Manage agents button: settings live under + and each agent's ⋯.
      expect(await ui.find({ key: 'manage' })).toBeUndefined()
      expect(await ui.find({ text: /Manage agents/ })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('+ then Edit agents opens the settings: Name, Title, Team, Model and List rows; Delete apart, below them', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: `pin:${ID2}` })).toBeUndefined()
  await ui.press({ key: 'add' })
  await ui.press({ key: 'edit-agents' })
  expect(await ui.find({ key: `edit:${ID2}` })).toBeDefined()
  expect(await ui.find({ key: `delete:${ID2}` })).toBeUndefined()
  await ui.press({ key: `edit:${ID2}` })
  const whole = JSON.stringify(await ui.drawn())
  const drawn = whole.slice(whole.indexOf(`edit-${ID2}`))
  const labels = ['Name', 'Title', 'Team', 'Model', 'List'].map(name => drawn.indexOf(`"${name}"`))
  expect(labels.every(at => at > -1)).toBe(true)
  expect([...labels].sort((a, b) => a - b)).toEqual(labels)
  expect(drawn.indexOf(`delete:${ID2}`)).toBeGreaterThan(labels.at(-1)!)
  // Team, Model and List sit beside their labels; the desktop's name and title fields are stacked under theirs.
  expect((await ui.findAll({ type: 'Box', width: 7 } as never)).length).toBeGreaterThanOrEqual(3)
  expect(await ui.find({ type: 'Client', key: `rename:${ID2}`, width: '100%' } as never)).toBeDefined()
  await ui.press({ key: `edit:${ID2}` })
  expect(await ui.find({ key: `model:${ID2}` })).toBeUndefined()
  await ui.press({ key: 'done' })
  expect(await ui.find({ key: `compose:${ID1}` })).toBeDefined()
})

test('narrow desktop Edit panel: name and title are full-width plugin fields stacked under their labels; saving works and a clash is refused', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  await ui.press({ key: 'add' })
  await ui.press({ key: 'edit-agents' })
  await ui.press({ key: `edit:${ID2}` })
  expect(await ui.find({ type: 'Input', key: `rename:${ID2}` } as never)).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: `rename:${ID2}`, width: '100%' } as never)).toBeDefined()
  expect(await ui.find({ type: 'Client', key: `retitle:${ID2}`, width: '100%' } as never)).toBeDefined()
  expect((await ui.findAll({ type: 'Box', flexDirection: 'column', alignItems: 'stretch' } as never)).length).toBeGreaterThanOrEqual(4)
  await typeInto(ui, `rename:${ID2}`, 'agent 1')
  expect(await ui.find({ text: /Not saved: There is already a team member called Agent 1/ })).toBeDefined()
  expect(await ui.find({ text: /agent 1/, in: `rename:${ID2}` } as never)).toBeDefined()
  await ui.key({ key: 'a', meta: true, in: `rename:${ID2}` } as never)
  await typeInto(ui, `rename:${ID2}`, 'Mark')
  expect(await ui.find({ text: /Not saved/ })).toBeUndefined()
  expect(await ui.find({ text: /^Mark$/ })).toBeDefined()
  await typeInto(ui, `retitle:${ID2}`, 'Implementation')
  expect(await ui.find({ text: /Implementation · Team · sonnet/ })).toBeDefined()
})

test('the tiled (narrow) pane is the list alone: preview, no chat, no composer; the filled pane adds the chat', async ($, on) => {
  const reply = 'Here is the full answer to your question'
  world(on, appendLine(two(), ID2, { id: 'r', from: 'agent', text: reply, at: NOW - 1000 }))
  await start($)
  for (const surface of SURFACES) {
    const tiled = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface })
    expect(await canOpen(tiled, ID2)).toBe(true)
    await openAgent(tiled, ID2)
    expect(await tiled.find({ text: new RegExp(`^${reply}$`) })).toBeUndefined()
    expect(await tiled.find({ key: `compose:${ID2}` } as never)).toBeUndefined()
    expect(await tiled.find({ key: 'profile' } as never)).toBeUndefined()
    await tiled.unmount()
    const filled = await $.ui.mount({ ...PANE, surface })
    expect(await filled.find({ key: `compose:${ID2}` } as never)).toBeDefined()
    expect((await filled.findAll({ text: new RegExp(`^${reply}$`) })).length).toBeGreaterThan(0)
    await openAgent(filled, ID1)
    await filled.unmount()
  }
})

test('filled layout: chat full width above the bottom agent bar; tinted picked card, unframed centred chat with a portrait and name pill, no title', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 140 }, surface: 'desktop' })
  const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: Record<string, unknown>; text?: string }[]
  const row = (id: string) => boxes.find(one => one.props.key === `row-${id}`)
  expect(row(ID1)?.props.backgroundColor).toBe('#8a8f9840')
  expect(row(ID2)?.props.backgroundColor).toBeUndefined()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.slice(drawn.indexOf(`"key":"row-${ID2}"`)).indexOf('"hover":{"backgroundColor":"#8a8f9824"')).toBeLessThan(400)
  expect(boxes.some(one => one.props.key === `tag-${ID1}`)).toBe(false)
  // No side list: the agents sit in a bar after the chat, search and + first, then teams of fixed-width cards that wrap.
  expect(boxes.find(one => one.props.key === 'list')).toBeUndefined()
  const order = JSON.stringify(await ui.drawn())
  expect(order.indexOf('"agent-bar"')).toBeGreaterThan(order.indexOf(`compose:${ID1}`))
  expect(order.indexOf('"list-head"')).toBeGreaterThan(order.indexOf('"agent-bar"'))
  expect(order.indexOf(`"agent-${ID1}"`)).toBeGreaterThan(order.indexOf('"list-head"'))
  expect(boxes.find(one => one.props.key === 'bar-cards')?.props.flexWrap).toBe('wrap')
  // Near the mock's 235px card: 26 cells.
  expect(boxes.find(one => one.props.key === `agent-${ID1}`)?.props.width).toBe(26)
  // Each team under its heading, its people as cards inside it.
  expect(await ui.find({ text: /^TEAM$/ })).toBeDefined()
  expect(order.indexOf(`"agent-${ID1}"`)).toBeGreaterThan(order.indexOf('"bar-group-Team"'))
  expect(boxes.find(one => one.props.key === 'chat-frame')?.props.borderStyle).toBeUndefined()
  // No divider or capsule drawings: neither drew live; the header pill keeps the native rounded frame.
  expect(boxes.some(one => one.props.key === 'divider' || one.props.key === 'pill-capsule')).toBe(false)
  expect(boxes.find(one => one.props.key === 'profile')?.props.borderStyle).toBe('round')
  const chat = boxes.find(one => one.props.key === `chat-${ID1}`)
  expect(chat?.props.alignSelf).toBe('center')
  // The full pane width less 8% each side: 140 * 0.84.
  expect(chat?.props.width).toBe(118)
  const pill = boxes.find(one => one.props.key === 'profile')
  expect(pill?.props.alignSelf).toBe('center')
  expect(pill?.text).toBe('Agent 1')
  expect(await portrait(ui, 'Agent 1 portrait')).toBeDefined()
})

test('the list has search and + icons at its head: search narrows the list, + New agent adds one and opens its Edit panel', async ($, on) => {
  world(on, addAgent(two(), 'Team', NOW - 500))
  await start($)
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Larger glyphs: a magnifier and a full-width plus.
  expect(await terminal.find({ type: 'Button', key: 'search', label: '\u{1F50D}\uFE0E' } as never)).toBeDefined()
  expect(await terminal.find({ type: 'Button', key: 'add', label: '\uFF0B' } as never)).toBeDefined()
  await terminal.press({ key: 'search' })
  await terminal.input({ key: 'search:list', text: 'agent 2', kind: 'change' })
  const ids = addAgent(two(), 'Team', NOW - 500).agents.map(one => one.id)
  expect(await canOpen(terminal, ids[1]!)).toBe(true)
  expect(await canOpen(terminal, ids[0]!)).toBe(false)
  expect(await canOpen(terminal, ids[2]!)).toBe(false)
  await terminal.input({ key: 'search:list', text: 'nobody', kind: 'change' })
  expect(await terminal.find({ text: /^No agent matches\.$/ })).toBeDefined()
  await terminal.press({ key: 'search' })
  expect((await Promise.all(ids.map(id => canOpen(terminal, id)))).every(Boolean)).toBe(true)
  // Desktop: the search box is the plugin's own field; typing narrows the list.
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desktop.press({ key: 'search' })
  await desktop.resize({ columns: 28, rows: 3, in: 'search:list' } as never)
  await desktop.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'search:list' } as never)
  for (const key of ['3']) await desktop.key({ key, in: 'search:list' } as never)
  expect(await canOpen(desktop, ids[2]!)).toBe(true)
  expect(await canOpen(desktop, ids[0]!)).toBe(false)
  await desktop.press({ key: 'search' })
  await desktop.press({ key: 'add' })
  await desktop.press({ key: 'new-agent' })
  expect(await desktop.find({ key: 'done' })).toBeDefined()
  expect(await desktop.find({ key: 'new-agent' })).toBeUndefined()
  expect(await desktop.find({ text: /^Agent 4$/ })).toBeDefined()
  expect((await desktop.findAll({ type: 'Client' } as never)).some(one => /^rename:/.test(String((one as { key?: string }).key)))).toBe(true)
})

test('⋯ beside each agent opens Rename then Delete; Rename saves in place, a clash is refused', async ($, on) => {
  world(on)
  await start($)
  for (const bodyColumns of [40, 100]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'desktop' })
    expect(await ui.find({ type: 'Button', key: `menu:${ID2}`, label: '⋯' } as never)).toBeDefined()
    // The row's pick layer does not cover the ⋯.
    const drawn = JSON.stringify(await ui.drawn())
    const hit = drawn.indexOf(`"hit-${ID2}"`)
    expect(drawn.indexOf(`pick:${ID2}`)).toBeGreaterThan(hit)
    expect(drawn.indexOf(`menu:${ID2}`)).toBeGreaterThan(drawn.indexOf(`pick:${ID2}`))
    await ui.press({ key: `menu:${ID2}` })
    const open = JSON.stringify(await ui.drawn())
    expect(open.indexOf(`rename-open:${ID2}`)).toBeGreaterThan(-1)
    expect(open.indexOf(`delete-ask:${ID2}`)).toBeGreaterThan(open.indexOf(`rename-open:${ID2}`))
    // A second press closes it.
    await ui.press({ key: `menu:${ID2}` })
    expect(await ui.find({ key: `rename-open:${ID2}` })).toBeUndefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  await ui.press({ key: `menu:${ID2}` })
  await ui.press({ key: `rename-open:${ID2}` })
  expect(await ui.find({ key: `rename-open:${ID2}` })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: `relabel:${ID2}`, width: '100%' } as never)).toBeDefined()
  await typeInto(ui, `relabel:${ID2}`, 'agent 1')
  expect(await ui.find({ text: /Not saved: There is already a team member called Agent 1/ })).toBeDefined()
  await ui.key({ key: 'a', meta: true, in: `relabel:${ID2}` } as never)
  await typeInto(ui, `relabel:${ID2}`, 'Tina')
  expect(await ui.find({ type: 'Client', key: `relabel:${ID2}` } as never)).toBeUndefined()
  expect(await ui.find({ text: /^Tina$/ })).toBeDefined()
  // The terminal renames through its own Input.
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await terminal.press({ key: `menu:${ID1}` })
  await terminal.press({ key: `rename-open:${ID1}` })
  await terminal.input({ key: `relabel:${ID1}`, text: 'Mark' })
  expect(await terminal.find({ type: 'Button', key: `open:${ID1}`, label: 'Mark' } as never)).toBeDefined()
  expect(await terminal.find({ key: `relabel:${ID1}` })).toBeUndefined()
})

test('Delete asks first: Cancel keeps the agent; only the named second press deletes it with its chat and draft', async ($, on) => {
  const seen = world(on, sendLine(two(), ID2, 'Keep this chat', NOW - 5000))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openAgent(ui, ID2)
  await ui.input({ key: `compose:${ID2}`, text: 'unsent words', kind: 'change' })
  await ui.press({ key: `menu:${ID2}` })
  await ui.press({ key: `delete-ask:${ID2}` })
  expect(await ui.find({ text: /^Delete Agent 2 and its whole chat\? This cannot be undone\.$/ })).toBeDefined()
  // Nothing is deleted by the ask.
  expect(await canOpen(ui, ID2)).toBe(true)
  await ui.press({ key: `keep:${ID2}` })
  expect(await ui.find({ key: `delete:${ID2}` })).toBeUndefined()
  expect(await canOpen(ui, ID2)).toBe(true)
  expect(await ui.find({ text: /^Keep this chat$/ })).toBeDefined()
  await ui.press({ key: `menu:${ID2}` })
  await ui.press({ key: `delete-ask:${ID2}` })
  await ui.press({ key: `delete:${ID2}` })
  expect(await canOpen(ui, ID2)).toBe(false)
  expect(await canOpen(ui, ID1)).toBe(true)
  expect(await ui.find({ text: /Keep this chat/ })).toBeUndefined()
  // The pick moves to the agent left; nothing went to Claude.
  expect(await ui.find({ key: `compose:${ID1}` })).toBeDefined()
  expect(seen.prompts).toHaveLength(0)
})

test('unread is a real count: it grows while the chat is off screen, a tiled pick keeps it, the filled chat clears it', async ($, on) => {
  const seen = world(on, two(), true)
  await start($)
  let wide = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const badge = async (ui: typeof wide) => ((await ui.find({ key: `unread-${ID1}` } as never)) as { text?: string } | undefined)?.text
  expect(await badge(wide)).toBeUndefined()
  await openAgent(wide, ID2)
  await claudeStarts($, 'Agent 1', 'toolu_a')
  await $.turn.complete(complete('loop-1', 'First answer'))
  await claudeStarts($, 'Agent 1', 'toolu_b')
  await $.turn.complete(complete('loop-2', 'Second answer'))
  expect(await badge(wide)).toBe('2')
  expect(await badge(wide)).not.toMatch(/New|unread/)
  await wide.unmount()
  // Tiled: picking Agent 1 shows no chat, so its count stays.
  const tiled = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  await openAgent(tiled, ID1)
  expect(await badge(tiled)).toBe('2')
  // A reply while it is picked but tiled still counts.
  await claudeStarts($, 'Agent 1', 'toolu_c')
  await $.turn.complete(complete('loop-3', 'Third answer'))
  expect(await badge(tiled)).toBe('3')
  await tiled.unmount()
  // Filled: its chat is on screen, so the count clears, and a reply while it shows adds none.
  wide = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await seen.clock.advance(600)
  expect(await badge(wide)).toBeUndefined()
  await claudeStarts($, 'Agent 1', 'toolu_d')
  await $.turn.complete(complete('loop-4', 'Fourth answer'))
  expect(await badge(wide)).toBeUndefined()
  // The terminal draws the count as text.
  await openAgent(wide, ID2)
  await claudeStarts($, 'Agent 1', 'toolu_e')
  await $.turn.complete(complete('loop-5', 'Fifth answer'))
  const terminal = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /^\(1\)$/ } as never)).toBeDefined()
})

test('pick layers over the name, the rest of its line and the preview line; the photo has none (the desktop keeps image presses); ⋯ right after the name, outside them', async ($, on) => {
  world(on, two(), true)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Client', key: `pick:${ID2}:face` } as never)).toBeUndefined()
  expect(await portrait(ui, 'Agent 2 portrait')).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  const name = drawn.indexOf(`"pick:${ID2}:name"`)
  const menu = drawn.indexOf(`"menu:${ID2}"`)
  expect(name).toBeGreaterThan(-1)
  expect(menu).toBeGreaterThan(name)
  expect(drawn.indexOf(`"pick:${ID2}:gap"`)).toBeGreaterThan(menu)
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${ID2}:name` } as never)
  expect(await ui.find({ key: `compose:${ID2}` } as never)).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${ID1}:gap` } as never)
  expect(await ui.find({ key: `compose:${ID1}` } as never)).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${ID2}` } as never)
  expect(await ui.find({ key: `compose:${ID2}` } as never)).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${ID1}` } as never)
  expect(await ui.find({ key: `compose:${ID1}` } as never)).toBeDefined()
})

test('a short chat: the pane one screen tall, the history window takes what the pill, composer and bar leave', async ($, on) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const root = await ui.drawn()
    const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: Record<string, unknown> }[]
    // The screen is the pane's rows, clipped; below it an empty runway gives the desktop room to raise wheel events.
    expect(boxes.find(one => one.props.key === 'screen')?.props).toMatchObject({ height: PANE.props.scroll.bodyRows, overflow: 'hidden' })
    expect(boxes.find(one => one.props.key === 'runway')?.props.height).toBe(15)
    expect(boxes.find(one => one.props.key === 'chat-frame')?.props.flexGrow).toBe(1)
    expect(boxes.find(one => one.props.key === 'history')?.props).toMatchObject({ flexGrow: 1, flexShrink: 1, overflow: 'hidden', justifyContent: 'flex-end' })
    const drawn = JSON.stringify(root)
    expect(drawn.indexOf(`compose:${ID1}`)).toBeGreaterThan(drawn.indexOf('"history"'))
    expect(drawn.indexOf('"agent-bar"')).toBeGreaterThan(drawn.indexOf(`compose:${ID1}`))
    await ui.unmount()
  }
  // Tiled: the list alone, sized by its rows.
  const tiled = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  expect(((await tiled.drawn()) as { props: { height?: number; minHeight?: number } }).props.height).toBeUndefined()
  expect(await tiled.find({ key: 'runway' } as never)).toBeUndefined()
})

test('mock details: round icon frames, a bordered picked row against a borderless hover, Rename in place of the name line', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: Record<string, unknown> }[]
  for (const ring of ['search-ring', 'add-ring']) expect(boxes.find(one => one.props.key === ring)?.props.borderStyle).toBe('round')
  const row = (id: string) => boxes.find(one => one.props.key === `row-${id}`)?.props
  expect(row(ID1)?.borderColor).toBe('#8a8f98a6')
  expect(row(ID2)?.borderColor).toBe('#00000000')
  await ui.press({ key: `menu:${ID2}` })
  await ui.press({ key: `rename-open:${ID2}` })
  // The field takes the name line: the name and its ⋯ give way until it is saved or cancelled.
  expect(await ui.find({ type: 'Client', key: `relabel:${ID2}` } as never)).toBeDefined()
  expect(await ui.find({ type: 'Client', key: `pick:${ID2}:name` } as never)).toBeUndefined()
  expect(await ui.find({ key: `menu:${ID2}` })).toBeUndefined()
  await ui.press({ key: `rename-cancel:${ID2}` })
  expect(await ui.find({ key: `menu:${ID2}` })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: `relabel:${ID2}` } as never)).toBeUndefined()
})

test('photos at the mock sizes: 44px in the list, 32px in the pill, each in a box of cells that holds it', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = (await ui.findAll({ type: 'Svg' } as never)) as { props: { alt?: string; width?: number; height?: number } }[]
  expect(svgs.filter(one => one.props.alt?.startsWith('Agent') && one.props.width === 44 && one.props.height === 44)).toHaveLength(2)
  expect(svgs.filter(one => one.props.width === 32 && one.props.height === 32)).toHaveLength(1)
  const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: Record<string, unknown> }[]
  const photo = boxes.find(one => one.props.key === `photo-${ID1}`)?.props
  expect([photo?.width, photo?.height, photo?.flexShrink]).toEqual([6, 3, 0])
  const pill = boxes.find(one => one.props.key === 'pill-photo')?.props
  expect([pill?.width, pill?.height]).toEqual([5, 2])
})

test('a Save button stores what is typed in the name and title fields, wide desktop Edit panel', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await editAgents(ui)
  await ui.press({ key: `edit:${ID2}` })
  for (const [box, words] of [[`rename:${ID2}`, 'Chen'], [`retitle:${ID2}`, 'Tech Lead']] as const) {
    await ui.resize({ columns: 40, rows: 3, in: box } as never)
    await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: box } as never)
    for (const key of words) await ui.key({ key: key === ' ' ? 'space' : key, in: box } as never)
  }
  await ui.press({ key: `save-fields:${ID2}` })
  expect(await ui.find({ text: /^Chen$/ })).toBeDefined()
  expect(await ui.find({ text: /Tech Lead · Team · sonnet/ })).toBeDefined()
})
