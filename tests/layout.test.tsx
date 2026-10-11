import { expect, test } from 'claude-code/testing'
import { appendLine, sendLine } from '../hooks/model'
import { ADD, ID1, ID2, NOW, PANE, SURFACES, editAgents, inChat, openAgent, start, two, world } from './world'

// The person's wheel over the pane, as the engine raises it (negative toward the top).
const wheel = ($: { ui: { scroll: (e: never) => Promise<unknown> } }, by: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'agents', offset: 0, by, bodyRows: 30, contentRows: 30, origin: { kind: 'person' } } as never)

// The chat's lines drawn now, in order (each found once as its Text), and whether the fixed parts are all there.
// (Agent replies draw as Markdown; the bar's one-line previews, cut at their edge, are left out.)
const chatLines = async (ui: { findAll: (q: never) => Promise<unknown[]> }, prefix: string) =>
  ((await ui.findAll({ text: new RegExp(`^${prefix} \\d+$`) } as never)) as { type?: string; text?: string; props?: { wrap?: string } }[])
    .filter(one => one.type === 'Markdown' || (one.type === 'Text' && one.props?.wrap !== 'truncate-end'))
    .map(found => Number(found.text?.slice(prefix.length + 1)))

test('the filled chat keeps its pill, composer and bar in place; the wheel moves only the history, oldest to newest, every message reachable', async ($, on) => {
  const long = Array.from({ length: 60 }, (_, n) => n).reduce(
    (acc, n) => appendLine(acc, ID1, { id: `old-${n}`, from: n % 2 === 0 ? 'you' : 'agent', text: `line ${n}`, at: NOW - 100_000 + n }),
    two(),
  )
  world(on, long)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const fixed = async () => {
      const drawn = JSON.stringify(await ui.drawn())
      const [pill = -1, history = -1, composer = -1, bar = -1] = ['"profile"', '"history"', `compose:${ID1}`, '"agent-bar"'].map(key => drawn.indexOf(key))
      return pill > -1 && history > pill && composer > history && bar > composer
    }
    // At rest: the newest lines, in order, ending with the last; the pane is one screen tall and clipped.
    const screen = ((await ui.findAll({ type: 'Box' } as never)) as { props: Record<string, unknown> }[]).find(one => one.props.key === 'screen')
    expect(screen?.props).toMatchObject({ height: 30, overflow: 'hidden' })
    const newest = await chatLines(ui, 'line')
    expect(newest.at(-1)).toBe(59)
    expect(newest).toEqual(Array.from({ length: newest.length }, (_, n) => 60 - newest.length + n))
    expect(newest.length).toBeLessThan(60)
    expect(await fixed()).toBe(true)
    expect(await ui.find({ key: 'to-newest' })).toBeUndefined()
    // Wheel ticks back: older lines come in, still in order; the pane's own move is denied.
    const seen = new Set(newest)
    let lines = newest
    for (let tick = 0; tick < 200 && !seen.has(0); tick += 1) {
      expect(await wheel($, -1)).toEqual({})
      lines = await chatLines(ui, 'line')
      expect(lines).toEqual([...lines].sort((x, y) => x - y))
      for (const line of lines) seen.add(line)
      expect(await fixed()).toBe(true)
    }
    // Every message was reachable, the oldest drawn from the top, and a way back to the newest offered.
    expect(seen.size).toBe(60)
    expect(lines[0]).toBe(0)
    expect(await ui.find({ key: 'to-newest' })).toBeDefined()
    // A page (by = the pane's rows) moves a page of rows, not three: newer lines, still in order.
    const before = await chatLines(ui, 'line')
    await wheel($, 30)
    const paged = await chatLines(ui, 'line')
    expect((paged.at(-1) ?? 0) - (before.at(-1) ?? 0)).toBeGreaterThanOrEqual(5)
    // End (by = the tree's rows) lands at the newest, not past it.
    await wheel($, 1000)
    expect((await chatLines(ui, 'line')).at(-1)).toBe(59)
    expect(await ui.find({ key: 'to-newest' })).toBeUndefined()
    // Home lands at the oldest; ↓ Newest returns.
    await wheel($, -1000)
    expect((await chatLines(ui, 'line'))[0]).toBe(0)
    await ui.press({ key: 'to-newest' })
    expect((await chatLines(ui, 'line')).at(-1)).toBe(59)
    for (const key of ['older', 'newer']) expect(await ui.find({ key })).toBeUndefined()
    await ui.unmount()
  }
})

test('tiled and Edit agents scroll natively: the wheel is passed on, not taken', async ($, on) => {
  world(on)
  // Stands in for the engine's own move beneath the plugin: counts the moves passed on.
  let passed = 0
  on('ui.scroll', () => {
    passed += 1
    return {}
  })
  await start($)
  const tiled = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  await wheel($, -1)
  expect(passed).toBe(1)
  await tiled.unmount()
  const filled = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await wheel($, -1)
  expect(passed).toBe(1)
  await editAgents(filled)
  await wheel($, -1)
  expect(passed).toBe(2)
  expect(((await filled.drawn()) as { props: { height?: number; minHeight?: number } }).props).toMatchObject({ minHeight: 30 })
})

test('sending shows the newest message, even after scrolling back', async ($, on) => {
  const long = Array.from({ length: 40 }, (_, n) => n).reduce(
    (acc, n) => appendLine(acc, ID1, { id: `old-${n}`, from: 'agent', text: `line ${n}`, at: NOW - 100_000 + n }),
    two(),
  )
  world(on, long)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await wheel($, -1000)
  expect((await chatLines(ui, 'line'))[0]).toBe(0)
  await ui.input({ key: `compose:${ID1}`, text: 'line 99' })
  expect((await chatLines(ui, 'line')).at(-1)).toBe(99)
})

test('a new agent gets the next shipped photo; the drawn face when the photos cannot be read', async ($, on) => {
  const reads: string[] = []
  world(on, null)
  on('fs.read', ($, e) => {
    reads.push(e.path)
    return { value: { base64: 'QUJD' } }
  })
  await start($)
  await $.tool.call({ tool: ADD, name: 'Scout' })
  expect(reads.at(-1)).toMatch(/\/photos\/001\.jpg$/)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Svg', source: /data:image\/jpeg;base64,QUJD/ } as never)).toBeDefined()
})

test('the narrow pane shows each agent portrait beside its name', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  for (const name of ['Agent 1', 'Agent 2']) {
    const face = ((await ui.findAll({ type: 'Svg' } as never)) as { props: { alt?: string; width?: number } }[]).find(one => one.props.alt === `${name} portrait` && one.props.width === 44)
    expect(face).toBeDefined()
  }
})

test('the desktop composer spans the column, types, sends on Enter, and empties', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const box = `compose:${ID1}`
  expect(await ui.find({ type: 'Client', key: box, width: '100%' } as never)).toBeDefined()
  expect(await ui.find({ type: 'Input' } as never)).toBeUndefined()
  await ui.resize({ columns: 60, rows: 3, in: box })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: box } as never)
  for (const key of ['H', 'i', 'space', 't', 'h', 'e', 'r', 'e']) await ui.key({ key, in: box })
  expect(await ui.find({ text: /Hi ther/, in: box })).toBeDefined()
  await ui.key({ key: 'return', in: box })
  expect(seen.prompts.at(-1)!.text).toContain('Agent 1')
  expect(await ui.find({ text: /Hi there/, in: box })).toBeUndefined()
  expect(await ui.find({ text: /Message Agent 1/, in: box })).toBeDefined()
})

test('picking an agent shows its chat at the newest message, oldest first above it, just above the composer', async ($, on) => {
  const long = Array.from({ length: 60 }, (_, n) => n).reduce(
    (acc, n) => appendLine(acc, ID2, { id: `two-${n}`, from: n % 2 === 0 ? 'you' : 'agent', text: `two ${n}`, at: NOW - 100_000 + n }),
    two(),
  )
  world(on, long)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await openAgent(ui, ID2)
    const lines = await chatLines(ui, 'two')
    expect(lines.at(-1)).toBe(59)
    expect(lines).toEqual([...lines].sort((x, y) => x - y))
    const drawn = JSON.stringify(await ui.drawn())
    const chat = drawn.slice(0, drawn.indexOf('"agent-bar"'))
    expect(chat.indexOf(`compose:${ID2}`)).toBeGreaterThan(chat.lastIndexOf('two 59'))
    await openAgent(ui, ID1)
    await ui.unmount()
  }
})

test('each agent card lights as one rectangle under the pointer on desktop', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  type Node = { key?: string; props?: { key?: string }; hover?: { backgroundColor?: string }; children?: unknown[] }
  const walk = (node: unknown): Node | undefined => {
    if (typeof node !== 'object' || node === null) return undefined
    const one = node as Node
    if (one.props?.key === `row-${ID1}`) return one
    for (const child of one.children ?? []) {
      const hit = walk(child)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  expect(walk(await ui.drawn())?.hover?.backgroundColor).toBeDefined()
  // Each card has its own rounded border; the picked agent's is coral.
  const boxes = (await ui.findAll({ type: 'Box' } as never)) as { props: { key?: string; borderStyle?: string; borderColor?: string } }[]
  const cardOf = (id: string) => boxes.find(one => one.props.key === `row-${id}`)
  expect(cardOf(ID1)?.props.borderStyle).toBe('round')
  expect(cardOf(ID2)?.props.borderStyle).toBe('round')
  expect(cardOf(ID1)?.props.borderColor).not.toBe(cardOf(ID2)?.props.borderColor)
})

test('a press anywhere on an agent row opens it on desktop, also from Manage agents; the terminal uses the name button', async ($, on) => {
  world(on, sendLine(two(), ID2, 'Hello two', NOW - 60_000))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const hello = /^Hello two$/
  // One layer over the row's name, preview and count (the desktop keeps presses on the photo); the ⋯ stays its own button.
  expect(await ui.find({ type: 'Client', key: `pick:${ID2}` } as never)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `open:${ID2}` } as never)).toBeUndefined()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${ID2}` } as never)
  expect(await inChat(ui, hello)).not.toHaveLength(0)
  await ui.pointer({ type: 'up', x: 9, y: 1, button: 'left', in: `pick:${ID1}` } as never)
  expect(await inChat(ui, hello)).toHaveLength(0)
  // From Manage agents with an Edit panel open, a press on a row opens that chat.
  await editAgents(ui)
  await ui.press({ key: `edit:${ID1}` })
  expect(await ui.find({ key: 'done' })).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `pick:${ID2}` } as never)
  expect(await ui.find({ key: 'done' })).toBeUndefined()
  expect(await inChat(ui, hello)).not.toHaveLength(0)
  // The terminal has no layer: the name button opens the chat.
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Client' } as never)).toBeUndefined()
  await terminal.press({ key: `open:${ID1}` })
  expect(await inChat(terminal, hello)).toHaveLength(0)
})
