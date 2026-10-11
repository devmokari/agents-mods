import { expect, test } from 'claude-code/testing'

import { boundaries, edit, fallbackBoundaries, selectedText } from '../hooks/composer'
import type { Field } from '../hooks/composer'
import { addAgent, emptyRoster, renameLegacyTeam, setPhoto } from '../hooks/model'
import { faceSvg, portraitSvg } from '../hooks/faces'
import { draftAfterSend } from '../hooks/relay'

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
const PHOTO = 'data:image/jpeg;base64,AAAA'

test('a photo replaces the drawn face, keeps the status ring, and clears back to the face', async () => {
  const roster = addAgent(emptyRoster(), 'Team', NOW)
  const set = setPhoto(roster, 'agent 1', PHOTO)
  const agent = set.roster.agents[0]!
  expect(agent.photo).toBe(PHOTO)
  expect(portraitSvg(agent, 'thinking')).toContain(`href="${PHOTO}"`)
  expect(portraitSvg(agent, 'thinking')).toContain('<animate')
  const cleared = setPhoto(set.roster, 'Agent 1', undefined).roster.agents[0]!
  expect('photo' in cleared).toBe(false)
  expect(portraitSvg(cleared, 'ready')).toBe(faceSvg(cleared.face, 'ready'))
  expect(setPhoto(roster, 'Nobody', PHOTO).error).toContain('Nobody')
})

test('a saved roster old "Team" becomes "Uncategorised"; other teams stay', () => {
  const old = { agents: [], teams: ['Team', 'Research'], chats: {}, nextNumber: 1 }
  const withAgent = addAgent(old, 'Team', NOW)
  const renamed = renameLegacyTeam(withAgent)
  expect(renamed.teams).toEqual(['Uncategorised', 'Research'])
  expect(renamed.agents[0]!.team).toBe('Uncategorised')
  expect(renameLegacyTeam(renamed)).toBe(renamed)
})

const f = (text: string, at = text.length, anchor: number | null = null): Field => ({ text, at, anchor })

test('composer keys: characters, cursor moves, deletes, Shift+Enter breaks a line, Enter sends', () => {
  expect(edit(f('ac', 1), { key: 'b' }).field).toEqual(f('abc', 2))
  expect(edit(f('abc'), { key: 'backspace' }).field).toEqual(f('ab', 2))
  expect(edit(f('abc', 0), { key: 'backspace' }).field).toEqual(f('abc', 0))
  expect(edit(f('abc', 1), { key: 'delete' }).field).toEqual(f('ac', 1))
  expect(edit(f('abc', 1), { key: 'left' }).field.at).toBe(0)
  expect(edit(f('abc'), { key: 'right' }).field.at).toBe(3)
  expect(edit(f('abc', 2), { key: 'a', ctrl: true }).field.at).toBe(0)
  expect(edit(f('ab', 1), { key: 'space' }).field).toEqual(f('a b', 2))
  expect(edit(f('ab'), { key: 'return', shift: true }).field).toEqual(f('ab\n', 3))
  expect(edit(f('ab'), { key: 'return' }).action).toBe('send')
  expect(edit(f('a'), { key: 'pasted text' }).field).toEqual(f('apasted text', 12))
  // Cmd+V cannot read the clipboard from a surface module: it changes nothing (a surface may type the paste instead).
  expect(edit(f('a'), { key: 'v', meta: true }).field).toEqual(f('a'))
})

test('composer: Cmd+Left/Right jump to the ends instead of moving one character; Shift extends', () => {
  expect(edit(f('hello', 3), { key: 'left', meta: true }).field).toEqual(f('hello', 0))
  expect(edit(f('hello', 2), { key: 'right', meta: true }).field).toEqual(f('hello', 5))
  expect(edit(f('hello', 3), { key: 'left', meta: true, shift: true }).field).toEqual(f('hello', 0, 3))
  expect(edit(f('hello', 1), { key: 'right', shift: true }).field).toEqual(f('hello', 2, 1))
})

test('composer: select all, typing and paste replace the selection, deletes take it, arrows collapse it', () => {
  const all = edit(f('hello', 2), { key: 'a', meta: true }).field
  expect(all).toEqual(f('hello', 5, 0))
  expect(selectedText(all)).toBe('hello')
  expect(edit(all, { key: 'x' }).field).toEqual(f('x', 1))
  expect(edit(all, { key: 'pasted words' }).field).toEqual(f('pasted words', 12))
  expect(edit(all, { key: 'backspace' }).field).toEqual(f('', 0))
  expect(edit(f('hello', 1, 4), { key: 'delete' }).field).toEqual(f('ho', 1))
  expect(edit(f('hello', 4, 1), { key: 'left' }).field).toEqual(f('hello', 1))
  expect(edit(f('hello', 1, 4), { key: 'right' }).field).toEqual(f('hello', 4))
})

test('composer: copy and cut ask for the selection only on Cmd+C / Cmd+X; nothing selected, nothing copied', () => {
  const sel = f('hello world', 5, 0)
  expect(edit(sel, { key: 'c', meta: true })).toEqual({ field: sel, action: 'copy' })
  expect(edit(sel, { key: 'x', meta: true })).toEqual({ field: f(' world', 0), action: 'cut' })
  expect(edit(f('hello'), { key: 'c', meta: true }).action).toBeUndefined()
  expect(edit(f('hello'), { key: 'x', meta: true })).toEqual({ field: f('hello') })
})

test('composer: emoji, combining marks and family emoji move and delete as one character', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
  const accented = 'e\u0301'
  const thumbs = '\u{1F44D}\u{1F3FD}'
  const flag = '\u{1F1E6}\u{1F1FA}'
  for (const glyph of [family, accented, thumbs, flag, '\u{1F600}']) {
    const text = `a${glyph}b`
    expect(boundaries(text)).toEqual([0, 1, 1 + glyph.length, text.length])
    // The same pieces where the environment has no Intl.Segmenter.
    expect(fallbackBoundaries(text)).toEqual([0, 1, 1 + glyph.length, text.length])
    expect(edit(f(text, 1 + glyph.length), { key: 'backspace' }).field).toEqual(f('ab', 1))
    expect(edit(f(text, 1), { key: 'delete' }).field).toEqual(f('ab', 1))
    expect(edit(f(text, 1), { key: 'right' }).field.at).toBe(1 + glyph.length)
    expect(edit(f(text, 1 + glyph.length), { key: 'left' }).field.at).toBe(1)
  }
})

test('after a send the draft empties only if unchanged: words typed while it waited stay, a refusal keeps all', () => {
  expect(draftAfterSend({ a: 'Hi', b: 'Other' }, 'a', 'Hi', true)).toEqual({ a: '', b: 'Other' })
  expect(draftAfterSend({ a: 'Hi there' }, 'a', 'Hi', true)).toEqual({ a: 'Hi there' })
  expect(draftAfterSend({ a: 'Hi' }, 'a', 'Hi', false)).toEqual({ a: 'Hi' })
  expect(draftAfterSend({}, 'a', 'Hi', true)).toEqual({})
})
