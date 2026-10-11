import { expect, mock, test } from 'claude-code/testing'
import { emptyRoster } from '../hooks/model'
import { ID1, ID2, canOpen, start, two, world } from './world'

const PANE = {
  plugin: 'agents',
  component: 'Pane',
  requestId: 'agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pane draws agents Claude added to a new team, on desktop and terminal', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9) })
  mock.store(on, {})
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__agents__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__agents__add_agent', name: 'Scout', title: 'Research & Audit', team: 'Research', model: 'sonnet' } as never)
  await $.tool.call({ tool: 'mcp__agents__add_agent', name: 'Builder', title: 'Implementation', team: 'Research', model: 'opus' } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /^Scout$/ })).toBeDefined()
    await ui.unmount()
  }
  const { bodyColumns: _, ...noWidth } = PANE.props
  const ui = await $.ui.mount({ ...PANE, props: noWidth as never, surface: 'desktop' })
  expect(await ui.find({ text: /^Scout$/ })).toBeDefined()
})

test('the first start under the new name brings the agents and chats saved as agent-mode across, the fullest copy', async ($, on) => {
  world(on, null)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.list', ($, e) => ({
    value: e.path === '/home/me/.claude/plugins/store' ? [
      { name: 'agent-mode_old-1.json', kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false },
      { name: 'agent-mode_inline-2.json', kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false },
      { name: 'other_plugin.json', kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false },
    ] : [],
  }))
  on('fs.read', ($, e) => ({
    value: e.path.endsWith('agent-mode_inline-2.json') ? JSON.stringify({ roster: two() }) : e.path.endsWith('agent-mode_old-1.json') ? JSON.stringify({ roster: emptyRoster() }) : '{}',
  }))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await canOpen(ui, ID1)).toBe(true)
  expect(await canOpen(ui, ID2)).toBe(true)
})
