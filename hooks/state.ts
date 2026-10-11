// The plugin's constants, state atoms, palette and the desktop composer's bookkeeping: nothing here touches `$`.

export const PANE = 'agents'
export const TITLE = 'Agents'
export const COMMAND = 'faces'


// The desktop composer's words per agent, kept outside state so typing does not redraw the pane.
export const clientDrafts: Record<string, string> = {}
// Its sends, numbered by the composer: the last number taken, the one in flight, and how the last one ended.
export const clientSeq: Record<string, number> = {}
export const clientInflight: Record<string, SeqText> = {}
export const clientResolved: Record<string, { seq: number; isSent: boolean }> = {}
// The last copy request taken, by its number, so a repeated post copies once.
export const clientCopied: Record<string, number> = {}
// One send per agent at a time, from either composer.
export const sending: Record<string, true> = {}
// A Client that failed is drawn again under a new key (`pick:<id>~1`), a few times; past that the site falls back
// to the surface's own controls (the name Button, the built-in Input).
export const clientGen: Record<string, number> = {}
export const CLIENT_RETRIES = 3
export const clientKey = (base: string): string => ((clientGen[base] ?? 0) === 0 ? base : `${base}~${clientGen[base]}`)
export const isClientUsable = (base: string): boolean => (clientGen[base] ?? 0) <= CLIENT_RETRIES
export const clientBase = (element: string): string => element.split('~')[0] ?? element

export type SeqText = { seq: number; text: string }
export const asSeqText = (value: unknown): SeqText | undefined => {
  const one = value as { seq?: unknown; text?: unknown } | null
  return typeof one === 'object' && one !== null && typeof one.seq === 'number' && typeof one.text === 'string' ? { seq: one.seq, text: one.text } : undefined
}

// What the desktop composer instance is handed: its starting words, and where its sends stand.
export const composerProps = (id: string, name: string) => ({
  draft: clientDrafts[id] ?? '',
  placeholder: `Message ${name}…`,
  sending: clientInflight[id] ?? null,
  resolved: clientResolved[id] ?? null,
  lastSeq: clientSeq[id] ?? 0,
})

export const BUSY = 'Your previous message to this agent is still being sent.'

export const PROFILE_TOOL = 'mcp__agents__update_my_profile'
export const MESSAGE_TOOL = 'mcp__agents__message_teammate'
export const ADD_TOOL = 'mcp__agents__add_agent'
export const PHOTO_TOOL = 'mcp__agents__set_agent_photo'
export const AGENT_TOOL = 'Agent'

// The palette works in light and dark themes: text in theme keys, which follow the person's theme, and fills as
// 8-digit hex tints of a mid grey, which the desktop lays over whichever background the theme has.
// The terminal draws no fills (see isGraphic), only the text colours.
export const CARD = {
  border: '#8a8f9859',
  secondary: 'inactive',
  done: '#16a34a',
  working: '#2f6fed',
  waiting: '#b7791f',
  panel: '#8a8f9814',
  // List rows: the picked one clearly tinted, the one under the pointer lighter.
  row: '#8a8f9840',
  rowBorder: '#8a8f98a6',
  rowHover: '#8a8f9824',
  // Chat bubbles, as the mock: the agent's soft grey on the left, the person's unfilled on the right, both outlined.
  bubble: '#8a8f9826',
  // The unread count: white on green, readable on either theme.
  badge: '#25a865',
  badgeText: '#ffffff',
  dotWorking: '#2f6fed',
  dotWaiting: '#f59e0b',
}
