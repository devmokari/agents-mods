// The desktop composer: a full-width message field drawn by the plugin itself, since the surface's
// own Input keeps a fixed width. Keys arrive one by one while a click has given it the focus.
//
// What the Mods API gives a surface module, and so what this field can do: single keys with Ctrl, Shift and
// Cmd (no Alt/Option, so no word jumps), pointer events in whole cells, and `post` to the hooks module.
// It cannot read the clipboard: Cmd+C and Cmd+X post the selection to the hooks module, which writes it
// with `$.ui.copy`; Cmd+V can only work where the surface delivers the pasted text as typed characters.
import type { ClientKeyEvent, ClientModule } from 'claude-code'

type SeqText = { seq: number; text: string }
export type ComposerProps = {
  draft: string
  placeholder: string
  sending: SeqText | null
  resolved: { seq: number; isSent: boolean } | null
  lastSeq: number
  // The mark at the right end that sends (↑ by default; ✓ for a field that saves).
  glyph?: string
}

// The words, the cursor and the selection's other end (both UTF-16 offsets on grapheme boundaries).
export type Field = { text: string; at: number; anchor: number | null }
export type Edit = { field: Field; action?: 'send' | 'copy' | 'cut' }

// Grapheme boundaries: Intl.Segmenter where the environment has it, else a pattern that keeps combining marks,
// variation selectors, skin tones, ZWJ sequences (family emoji) and flag pairs in one piece.
const CLUSTER = /\p{RI}\p{RI}|(?:\r\n)|(?:\P{M}|\p{M})(?:\p{M}|\u{FE0F}|\p{Emoji_Modifier}|\u{200D}(?:\p{Extended_Pictographic}|\P{M})(?:\u{FE0F}|\p{Emoji_Modifier})?)*/gu
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined

export const fallbackBoundaries = (text: string): number[] => [0, ...[...text.matchAll(CLUSTER)].map(match => (match.index ?? 0) + match[0].length)]

export const boundaries = (text: string): number[] =>
  segmenter === undefined ? fallbackBoundaries(text) : [0, ...[...segmenter.segment(text)].map(part => part.index + part.segment.length)]

const before = (text: string, at: number): number => [...boundaries(text)].reverse().find(edge => edge < at) ?? 0
const after = (text: string, at: number): number => boundaries(text).find(edge => edge > at) ?? text.length

export const selection = (field: Field): [number, number] | undefined =>
  field.anchor === null || field.anchor === field.at ? undefined : [Math.min(field.anchor, field.at), Math.max(field.anchor, field.at)]

export const selectedText = (field: Field): string => {
  const range = selection(field)
  return range === undefined ? '' : field.text.slice(range[0], range[1])
}

// Typed or pasted words in place of the selection, or at the cursor.
const insert = (field: Field, words: string): Field => {
  const [from, to] = selection(field) ?? [field.at, field.at]
  return { text: field.text.slice(0, from) + words + field.text.slice(to), at: from + words.length, anchor: null }
}

const cut = (field: Field, from: number, to: number): Field => ({ text: field.text.slice(0, from) + field.text.slice(to), at: from, anchor: null })

// The cursor moved to `to`: with Shift the selection grows from where it started, without it collapses.
const move = (field: Field, to: number, isExtending: boolean): Field => ({
  text: field.text,
  at: to,
  anchor: isExtending ? (field.anchor ?? field.at) : null,
})

const NAMED = new Set(['up', 'down', 'left', 'right', 'return', 'tab', 'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end', 'escape'])

// One key applied to the field. Enter sends, Shift+Enter breaks the line. Cmd shortcuts come before plain keys,
// so Cmd+Left/Right jump to the ends instead of moving one character.
export const edit = (field: Field, key: ClientKeyEvent): Edit => {
  const name = key.key === 'space' ? ' ' : key.key
  const isShift = key.shift === true
  const range = selection(field)
  if (key.meta) {
    if (name === 'a') return { field: { text: field.text, at: field.text.length, anchor: 0 } }
    if (name === 'c') return { field, action: range === undefined ? undefined : 'copy' }
    if (name === 'x') return range === undefined ? { field } : { field: cut(field, range[0], range[1]), action: 'cut' }
    if (name === 'left' || name === 'up' || name === 'home') return { field: move(field, 0, isShift) }
    if (name === 'right' || name === 'down' || name === 'end') return { field: move(field, field.text.length, isShift) }
    if (name === 'backspace') return { field: range === undefined ? cut(field, 0, field.at) : cut(field, range[0], range[1]) }
    return { field }
  }
  if (key.ctrl) {
    if (name === 'a') return { field: move(field, 0, isShift) }
    if (name === 'e') return { field: move(field, field.text.length, isShift) }
    if (name === 'u') return { field: cut(field, 0, field.at) }
    return { field }
  }
  if (name === 'return') return isShift ? { field: insert(field, '\n') } : { field, action: 'send' }
  if (name === 'backspace') return { field: range !== undefined ? cut(field, range[0], range[1]) : cut(field, before(field.text, field.at), field.at) }
  if (name === 'delete') return { field: range !== undefined ? cut(field, range[0], range[1]) : cut(field, field.at, after(field.text, field.at)) }
  if (name === 'left') return { field: range !== undefined && !isShift ? move(field, range[0], false) : move(field, before(field.text, field.at), isShift) }
  if (name === 'right') return { field: range !== undefined && !isShift ? move(field, range[1], false) : move(field, after(field.text, field.at), isShift) }
  if (name === 'home') return { field: move(field, 0, isShift) }
  if (name === 'end') return { field: move(field, field.text.length, isShift) }
  if (NAMED.has(name) || name === '') return { field }
  // A character, or a run of them (a paste the surface hands over as one key).
  return { field: insert(field, name) }
}

type State = Field & {
  isFocused: boolean
  // The send waiting to be taken: further Enters do nothing until the hooks module answers it.
  pending: SeqText | null
  seq: number
  copy: SeqText | null
}

const ARROW_COLUMNS = 4

const Composer: ClientModule<ComposerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  // Every post is the whole picture, so one that replaces another in the same frame loses nothing.
  const post = (state: State) => surface.post({ draft: state.text, send: state.pending, copy: state.copy })
  const send = (now: State) => {
    if (now.pending !== null || now.text.trim() === '') return
    const next = { ...now, seq: now.seq + 1, pending: { seq: now.seq + 1, text: now.text } }
    surface.setState(next)
    post(next)
  }

  if (surface.state === undefined) {
    const lastSeq = Math.max(props.lastSeq, props.sending?.seq ?? 0)
    surface.setState({ text: props.draft, at: props.draft.length, anchor: null, isFocused: false, pending: props.sending, seq: lastSeq, copy: null })
    surface.onKey(key => {
      const now = surface.state
      if (now === undefined) return
      const result = edit(now, key)
      if (result.action === 'send') return send(now)
      const words = result.action === 'copy' || result.action === 'cut' ? selectedText(now) : ''
      const next: State = {
        ...now,
        ...result.field,
        isFocused: true,
        copy: words === '' ? now.copy : { seq: (now.copy?.seq ?? 0) + 1, text: words },
      }
      surface.setState(next)
      if (next.text !== now.text || next.copy !== now.copy) post(next)
    })
    surface.onPointer(event => {
      const now = surface.state
      if (now === undefined || event.type !== 'down') return
      if (event.x >= surface.columns - ARROW_COLUMNS) return send(now)
      if (!now.isFocused) surface.setState({ ...now, isFocused: true })
    })
  }
  const state = surface.state ?? { text: props.draft, at: props.draft.length, anchor: null, isFocused: false, pending: props.sending, seq: props.lastSeq, copy: null }

  // The hooks module answered the waiting send: taken, the words leave only if they are still the ones sent;
  // refused, they stay for another try.
  const answer = props.resolved
  if (surface.state !== undefined && state.pending !== null && answer !== null && answer.seq >= state.pending.seq) {
    const isUnchanged = state.text === state.pending.text
    surface.setState(answer.isSent && isUnchanged ? { ...state, text: '', at: 0, anchor: null, pending: null } : { ...state, pending: null })
  }

  const isEmpty = state.text === ''
  const range = selection(state)
  const cursorEnd = after(state.text, state.at)
  const under = state.text.slice(state.at, cursorEnd)

  return (
    <Box flexDirection="row" width="100%" borderStyle="round" borderColor={state.isFocused ? '#3b82f6' : '#5c5f66'} paddingX={1}>
      <Box flexGrow={1} flexShrink={1}>
        {isEmpty && !state.isFocused ? (
          <Text dimColor>{props.placeholder}</Text>
        ) : range !== undefined ? (
          <Text wrap="wrap">
            {state.text.slice(0, range[0])}
            <Text inverse>{state.text.slice(range[0], range[1])}</Text>
            {state.text.slice(range[1])}
          </Text>
        ) : (
          <Text wrap="wrap">
            {state.text.slice(0, state.at)}
            <Text inverse>{under === '' || under === '\n' ? ' ' : under}</Text>
            {under === '\n' ? '\n' : ''}
            {state.text.slice(cursorEnd)}
            {isEmpty ? <Text dimColor>{` ${props.placeholder}`}</Text> : ''}
          </Text>
        )}
      </Box>
      <Text bold color={isEmpty || state.pending !== null ? '#5c5f66' : undefined}>
        {state.pending !== null ? ' …' : ` ${props.glyph ?? '↑'}`}
      </Text>
    </Box>
  )
}

export default Composer
