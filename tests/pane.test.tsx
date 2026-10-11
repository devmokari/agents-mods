import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-mode',
  component: 'Pane',
  requestId: 'agent-mode',
  props: { title: 'Agents', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pane draws agents Claude added to a new team, on desktop and terminal', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9) })
  mock.store(on, {})
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__agent-mode__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__agent-mode__add_agent', name: 'Scout', title: 'Research & Audit', team: 'Research', model: 'sonnet' } as never)
  await $.tool.call({ tool: 'mcp__agent-mode__add_agent', name: 'Builder', title: 'Implementation', team: 'Research', model: 'opus' } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /^Scout$/ })).toBeDefined()
    await ui.unmount()
  }
  const { bodyColumns: _, ...noWidth } = PANE.props
  const ui = await $.ui.mount({ ...PANE, props: noWidth as never, surface: 'desktop' })
  expect(await ui.find({ text: /^Scout$/ })).toBeDefined()
})
