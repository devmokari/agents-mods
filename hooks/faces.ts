// Portraits: drawn faces on a pastel disc, photos clipped to it, the status ring and dot.
import type { Agent, Status } from '../types'

// Faces: AI portraits drawn as SVG cell grids, a ring per status.

type HairStyle = 'short' | 'long' | 'curly' | 'bun'
type Face = { bg: string; skin: string; hair: string; shirt: string; style: HairStyle; glasses?: true; beard?: true }

// Round illustrated portraits on a pastel disc, one per agent, in the order agents are added.
export const FACES: Face[] = [
  { bg: '#fbd3b9', skin: '#f1c7a0', hair: '#3b2a20', shirt: '#2563eb', style: 'long' },
  { bg: '#bfdbfe', skin: '#c68c5c', hair: '#111111', shirt: '#16a34a', style: 'short', beard: true },
  { bg: '#a7e8d6', skin: '#e8b48f', hair: '#9ca3af', shirt: '#475569', style: 'short', glasses: true, beard: true },
  { bg: '#fca5a5', skin: '#b9784f', hair: '#1c1917', shirt: '#334155', style: 'short' },
  { bg: '#ddd6fe', skin: '#f6d7b8', hair: '#e8c37a', shirt: '#0f766e', style: 'long' },
  { bg: '#a5f3fc', skin: '#6b4226', hair: '#1c1917', shirt: '#f59e0b', style: 'curly' },
  { bg: '#fbcfe8', skin: '#f3c9a8', hair: '#c2410c', shirt: '#7c3aed', style: 'bun' },
  { bg: '#fde68a', skin: '#d9a066', hair: '#27272a', shirt: '#be123c', style: 'curly', glasses: true },
]

export const RING_COLOR: Record<Status, string> = { ready: '#22c55e', thinking: '#06b6d4', acting: '#d946ef' }

// A working agent's ring: pulsing while it thinks, turning while it acts; none while idle.
const ring = (status: Status): string => {
  if (status === 'ready') return ''
  const motion =
    status === 'thinking'
      ? '<animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>'
      : '<animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="2s" repeatCount="indefinite"/>'
  const dash = status === 'acting' ? ' stroke-dasharray="7 4"' : ''

  return `<circle cx="20" cy="20" r="21.2" fill="none" stroke="${RING_COLOR[status]}" stroke-width="1.8"${dash}>${motion}</circle>`
}

const HAIR_BACK: Record<HairStyle, string> = {
  short: '',
  long: '<path d="M9.5 19 C9 9 14 5 20 5 C26 5 31 9 30.5 19 L31.5 33 L8.5 33 Z"/>',
  curly: '',
  bun: '<circle cx="20" cy="4.8" r="4"/><path d="M10 19 C10 11 14 7 20 7 C26 7 30 11 30 19 L30 25 L10 25 Z"/>',
}

const HAIR_TOP: Record<HairStyle, string> = {
  short: '<path d="M11.4 17.5 C10.6 9.5 15.5 6.2 20.5 6.4 C26 6.5 29.8 10.2 28.6 17.5 C27.4 13.6 24.4 11.8 20 11.8 C15.8 11.8 12.8 13.4 11.4 17.5 Z"/>',
  long: '<path d="M11.2 18.5 C10.8 10 15 6.4 20 6.4 C25.4 6.4 29.4 10 28.8 18.5 C27 14.5 23 12 18.4 11.6 C15.8 13 13 15.2 11.2 18.5 Z"/>',
  curly:
    '<circle cx="13" cy="13" r="3.6"/><circle cx="16.6" cy="9.4" r="3.8"/><circle cx="21" cy="8.6" r="3.9"/>' +
    '<circle cx="25.4" cy="10.4" r="3.6"/><circle cx="27.6" cy="14.4" r="3"/><circle cx="12" cy="16.8" r="2.4"/>',
  bun: '<path d="M11.4 18 C11 10.4 15.2 7.2 20 7.2 C24.8 7.2 29 10.4 28.6 18 C27 14 24 12.2 20 12.2 C16 12.2 13 14 11.4 18 Z"/>',
}

export const faceSvg = (index: number, status: Status): string => {
  const face = FACES[((index % FACES.length) + FACES.length) % FACES.length] ?? FACES[0]!
  const glasses = face.glasses
    ? '<g fill="none" stroke="#1f2937" stroke-width="0.8"><circle cx="16.6" cy="18.6" r="2.4"/><circle cx="23.4" cy="18.6" r="2.4"/><path d="M19 18.4 L21 18.4"/></g>'
    : ''
  const beard = face.beard ? `<path d="M12.6 20.5 C13.4 27.5 16.8 29 20 29 C23.2 29 26.6 27.5 27.4 20.5 C25.6 24.6 23 25.4 20 25.4 C17 25.4 14.4 24.6 12.6 20.5 Z" fill="${face.hair}"/>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 44 44">` +
    `<defs><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath></defs>` +
    `<circle cx="20" cy="20" r="20" fill="${face.bg}"/>` +
    `<g clip-path="url(#c)">` +
    `<g fill="${face.hair}">${HAIR_BACK[face.style]}</g>` +
    `<ellipse cx="20" cy="41" rx="15.5" ry="10.5" fill="${face.shirt}"/>` +
    `<rect x="17" y="24" width="6" height="6.5" rx="2" fill="${face.skin}"/>` +
    `<path d="M17 30 L20 33 L23 30" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="0.9"/>` +
    `<circle cx="11.9" cy="19.2" r="1.7" fill="${face.skin}"/><circle cx="28.1" cy="19.2" r="1.7" fill="${face.skin}"/>` +
    `<ellipse cx="20" cy="18.2" rx="8.2" ry="9.4" fill="${face.skin}"/>` +
    beard +
    `<g fill="${face.hair}">${HAIR_TOP[face.style]}</g>` +
    `<path d="M15.2 15.8 Q16.7 15 18.2 15.7 M21.8 15.7 Q23.3 15 24.8 15.8" fill="none" stroke="${face.hair}" stroke-width="0.8" stroke-linecap="round"/>` +
    `<circle cx="16.7" cy="18.6" r="0.95" fill="#2b1d16"/><circle cx="23.3" cy="18.6" r="0.95" fill="#2b1d16"/>` +
    `<path d="M17.4 22.6 Q20 24.8 22.6 22.6" fill="none" stroke="#9a4a3a" stroke-width="0.9" stroke-linecap="round"/>` +
    glasses +
    `</g>${ring(status)}</svg>`
  )
}

// A photo portrait: the picture clipped to the disc, the same status ring on top.
export const portraitSvg = (agent: Pick<Agent, 'face' | 'photo'>, status: Status): string =>
  agent.photo === undefined
    ? faceSvg(agent.face, status)
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 44 44">` +
      `<defs><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath></defs>` +
      `<image href="${agent.photo}" x="0" y="0" width="40" height="40" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>` +
      `${ring(status)}</svg>`

// A small status dot on a portrait's lower right, ringed in white so it reads on any photo; no colour, no dot.
export const withDot = (svg: string, color: string | undefined): string =>
  color === undefined ? svg : svg.replace(/<\/svg>$/, `<circle cx="34.5" cy="34.5" r="5.5" fill="${color}" stroke="#ffffff" stroke-width="2"/></svg>`)

// Keeps a portrait under the Svg element's 131072-character limit; a 96px JPEG is a few KB.
export const PHOTO_MAX = 100_000
const PHOTO_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
export const photoType = (path: string): string | undefined => PHOTO_TYPES[path.split('.').pop()?.toLowerCase() ?? '']

export const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: "The team member's name." },
    path: { type: 'string', description: 'Absolute path to a small square .png, .jpg or .webp (about 96px); empty to go back to the drawn face.' },
  },
  required: ['name', 'path'],
  additionalProperties: false,
}
