import { expect, test } from 'claude-code/testing'
import { ID1, ID2, MESSAGE, PANE, PROFILE, briefing, claudeStarts, complete, editAgents, hold, openAgent, start, three, world } from './world'

test('renames: a blank name or another agent\'s name is refused with a reason, in Manage agents and update_my_profile', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await editAgents(ui)
  await ui.press({ key: `edit:${ID2}` })
  await ui.input({ key: `rename:${ID2}`, text: 'agent 1' })
  expect(await ui.find({ text: /Not saved: There is already a team member called Agent 1/ })).toBeDefined()
  await ui.input({ key: `rename:${ID2}`, text: '   ' })
  expect(await ui.find({ text: /Not saved: A name cannot be empty/ })).toBeDefined()
  await ui.input({ key: `rename:${ID2}`, text: 'Tina' })
  expect(await ui.find({ text: /Not saved/ })).toBeUndefined()
  expect(await ui.find({ text: /^Tina$/ })).toBeDefined()

  await claudeStarts($, 'Agent 1')
  const clash = await $.tool.call({ tool: PROFILE, agentId: 'loop-1', name: 'TINA' })
  expect(String(clash.result)).toContain('Nothing changed: There is already a team member called Tina')
  const blank = await $.tool.call({ tool: PROFILE, agentId: 'loop-1', name: '  ' })
  expect(String(blank.result)).toContain('Nothing changed: A name cannot be empty')
  const own = await $.tool.call({ tool: PROFILE, agentId: 'loop-1', name: 'agent-1', title: 'Lead' })
  expect(String(own.result)).toContain('title is now Lead')
})

test('one send per agent at a time: a second send to the same agent while one waits is refused, not sent', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const box = `compose:${ID1}`
  await ui.resize({ columns: 60, rows: 3, in: box })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: box } as never)
  for (const key of ['H', 'i']) await ui.key({ key, in: box })
  const open = hold(seen)
  const sent = ui.key({ key: 'return', in: box })
  await ui.advance(50)
  // Another send to the same agent (a second composer, a new number) arrives while the first waits.
  await ui.post({ draft: 'Other words', send: { seq: 2, text: 'Other words' }, copy: null }, { in: box })
  expect(await ui.find({ text: /Not sent: Your previous message to this agent is still being sent/ })).toBeDefined()
  open()
  await sent
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]!.text).not.toContain('Other words')
})

test('terminal composer: a refused send keeps the words with the reason; the retry goes and empties the field', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  seen.drop = 'Claude is busy'
  await ui.input({ key: `compose:${ID1}`, text: 'Audit the homepage' })
  expect(await ui.find({ text: /Not sent: Claude is busy/ })).toBeDefined()
  const kept = (await ui.find({ key: `compose:${ID1}` } as never)) as { props?: { value?: string } } | undefined
  expect(kept?.props?.value).toBe('Audit the homepage')
  seen.drop = undefined
  await ui.input({ key: `compose:${ID1}`, text: 'Audit the homepage' })
  expect(seen.prompts).toHaveLength(1)
  expect(await ui.find({ text: /Not sent/ })).toBeUndefined()
  const emptied = (await ui.find({ key: `compose:${ID1}` } as never)) as { props?: { value?: string } } | undefined
  expect(emptied?.props?.value).toBe('')
})

test('desktop composer: Enter twice and a post replaced in the same frame still send once; newer words stay after acceptance', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const box = `compose:${ID1}`
  await ui.resize({ columns: 60, rows: 3, in: box })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: box } as never)
  for (const key of ['H', 'i']) await ui.key({ key, in: box })
  const open = hold(seen)
  const sent = ui.key({ key: 'return', in: box })
  await ui.key({ key: 'return', in: box })
  await ui.key({ key: '!', in: box })
  // A post that repeats the waiting send (as one replacing another in a frame would) is not sent again.
  await ui.post({ draft: 'Hi!', send: { seq: 1, text: 'Hi' }, copy: null }, { in: box })
  open()
  await sent
  expect(seen.prompts).toHaveLength(1)
  expect(await ui.find({ text: /Hi!/, in: box })).toBeDefined()
})

test('desktop composer: a refused send keeps the words and shows why; the retry sends and empties it', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const box = `compose:${ID1}`
  await ui.resize({ columns: 60, rows: 3, in: box })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: box } as never)
  for (const key of ['O', 'k']) await ui.key({ key, in: box })
  seen.drop = 'Claude is busy'
  await ui.key({ key: 'return', in: box })
  expect(await ui.find({ text: /Not sent: Claude is busy/ })).toBeDefined()
  expect(await ui.find({ text: /Ok/, in: box })).toBeDefined()
  seen.drop = undefined
  await ui.key({ key: 'return', in: box })
  expect(seen.prompts).toHaveLength(1)
  expect(await ui.find({ text: /Ok/, in: box })).toBeUndefined()
  expect(await ui.find({ text: /Not sent/ })).toBeUndefined()
})

test('desktop composer: a send waiting for one agent does not block another; each keeps its own words', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const one = `compose:${ID1}`
  await ui.resize({ columns: 60, rows: 3, in: one })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: one } as never)
  await ui.key({ key: 'A', in: one })
  const open = hold(seen)
  const first = ui.key({ key: 'return', in: one })
  await openAgent(ui, ID2)
  const two_ = `compose:${ID2}`
  await ui.resize({ columns: 60, rows: 3, in: two_ })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: two_ } as never)
  await ui.key({ key: 'B', in: two_ })
  const second = ui.key({ key: 'return', in: two_ })
  open()
  await first
  await second
  expect(seen.prompts.map(prompt => prompt.text).filter(text => /Agent 1|Agent 2/.test(text))).toHaveLength(2)
  expect(await ui.find({ text: /^B$/, in: two_ })).toBeUndefined()
})

test('desktop composer: Cmd+C and Cmd+X copy the selection through the host; nothing is copied before', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const box = `compose:${ID1}`
  await ui.resize({ columns: 60, rows: 3, in: box })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: box } as never)
  for (const key of ['h', 'e', 'y']) await ui.key({ key, in: box })
  expect(seen.copies).toEqual([])
  await ui.key({ key: 'a', meta: true, in: box })
  await ui.key({ key: 'c', meta: true, in: box })
  expect(seen.copies).toEqual(['hey'])
  await ui.key({ key: 'x', meta: true, in: box })
  expect(seen.copies).toEqual(['hey', 'hey'])
  expect(await ui.find({ text: /hey/, in: box })).toBeUndefined()
})

test('two agents asking one stopped teammate: each gets the answer to its own request, in turn', async ($, on) => {
  const seen = world(on, three())
  await start($)
  await claudeStarts($, 'Agent 1')
  await claudeStarts($, 'Agent 2')
  await $.tool.call({ tool: MESSAGE, agentId: 'loop-1', to: 'Agent 3', message: 'Question from one' })
  const second = await $.tool.call({ tool: MESSAGE, agentId: 'loop-2', to: 'Agent 3', message: 'Question from two' })
  expect(String(second.result)).toContain('Queued for Agent 3')
  await seen.clock.advance(600)
  expect(seen.prompts.filter(prompt => prompt.text.includes('name "agent-3"'))).toHaveLength(1)
  await claudeStarts($, 'Agent 3')
  expect(await briefing($, 'loop-3')).toContain('Question from one')
  await $.turn.complete(complete('loop-3', 'Answer for one'))
  await seen.clock.advance(600)
  expect(seen.appended).toContainEqual({ agentId: 'loop-1', text: 'Reply from your teammate Agent 3:\nAnswer for one' })
  expect(seen.appended.some(row => row.agentId === 'loop-2' && row.text.includes('Answer for one'))).toBe(false)

  // The second request goes out only now, and its own answer goes back to its sender.
  expect(seen.prompts.filter(prompt => prompt.text.includes('name "agent-3"'))).toHaveLength(2)
  await claudeStarts($, 'Agent 3')
  expect(await briefing($, 'loop-4')).toContain('Question from two')
  await $.turn.complete(complete('loop-4', 'Answer for two'))
  await seen.clock.advance(600)
  expect(seen.appended).toContainEqual({ agentId: 'loop-2', text: 'Reply from your teammate Agent 3:\nAnswer for two' })
  expect(seen.appended.some(row => row.agentId === 'loop-1' && row.text.includes('Answer for two'))).toBe(false)
})

test('a request to a busy teammate waits: the answer to its earlier, unrelated work does not go to the asker', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Agent 2 is at work on the person's task (loop-1); Agent 1 (loop-2) asks it something.
  await openAgent(ui, ID2)
  await ui.input({ key: `compose:${ID2}`, text: 'Write the meta descriptions' })
  await claudeStarts($, 'Agent 2')
  await claudeStarts($, 'Agent 1')
  const asked = await $.tool.call({ tool: MESSAGE, agentId: 'loop-2', to: 'Agent 2', message: 'Check the sitemap' })
  expect(String(asked.result)).toContain('Queued for Agent 2')
  await seen.clock.advance(600)
  expect(seen.appended.some(row => row.text.includes('Check the sitemap'))).toBe(false)

  // Agent 2 finishes the person's task: that answer is not the reply to Agent 1's request.
  await $.turn.complete(complete('loop-1', 'Meta descriptions written'))
  await seen.clock.advance(600)
  expect(seen.appended.some(row => row.agentId === 'loop-2' && row.text.includes('Meta descriptions written'))).toBe(false)

  // The request goes out now, and the answer to it is the one Agent 1 gets.
  expect(seen.prompts.at(-1)!.text).toContain('name "agent-2"')
  await claudeStarts($, 'Agent 2')
  expect(await briefing($, 'loop-3')).toContain('Check the sitemap')
  await $.turn.complete(complete('loop-3', 'Sitemap has 3 broken URLs.'))
  await seen.clock.advance(600)
  expect(seen.appended).toContainEqual({ agentId: 'loop-2', text: 'Reply from your teammate Agent 2:\nSitemap has 3 broken URLs.' })
})
