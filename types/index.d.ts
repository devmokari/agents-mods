export type Status = 'ready' | 'thinking' | 'acting'

export type Usage = { replies: number; tools: number; tokensIn: number; tokensOut: number }

export type Agent = {
  id: string
  name: string
  title: string
  team: string
  model: string
  face: number
  status: Status
  isPinned: boolean
  isUnread: boolean
  /** Replies that arrived while the chat was not on screen in the filled pane; absent in rosters saved before counts. */
  unread?: number
  abilities: string[]
  attributes: string[]
  usage: Usage
  /** A photo in place of the drawn face, as a data: URI; absent, the face. */
  photo?: string
}

export type Line = {
  id: string
  from: 'you' | 'agent' | 'note'
  text: string
  at: number
  isAnswered?: boolean
}

export type Roster = {
  agents: Agent[]
  teams: string[]
  chats: Record<string, Line[]>
  nextNumber: number
}

/** A teammate's request waiting for, or out with, the teammate it asked. */
export type Ask = { id: string; from: string; fromName: string; text: string; isDelivered: boolean; isSending?: true; loop?: string }

/** Teammate id → its requests, oldest first; only the head is ever out. */
export type Asks = Record<string, Ask[]>

export type Step = { at: number; text: string }

/** One run of a panel agent: one subagent loop, from its start to its answer. */
export type Run = {
  panelId: string
  startedAt: number
  steps: Step[]
  endedAt?: number
  answer?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-mode': {
      roster: Roster
      /** The agent open in the Agents inbox; null before the person picks one. */
      selected: string | null
      /** True while the inbox shows Manage agents in place of the conversation. */
      isManaging: boolean
      /** Agent id → the unsent words in that agent's composer. */
      drafts: Record<string, string>
      /** Agent id → why its last send did not reach Claude. */
      sendErrors: Record<string, string>
      /** Agent id → the briefing its next start reads through get_briefing. */
      briefs: Record<string, string>
      isPaneOpen: boolean
      /** Running subagent id → panel agent id, for this session. */
      runs: Record<string, string>
      /** Teammate id → the requests waiting on it, oldest first. */
      asks: Asks
      /** Agent id → why its last edit in Manage agents was refused. */
      manageErrors: Record<string, string>
      /** The words in the agent list's search box. */
      listFilter: string
      /** True while the agent list's search box is open. */
      isSearching: boolean
      /** The agent whose Edit panel is open in Manage agents; null when none is. */
      editing: string | null
      /** Subagent id → its run, for the cards in Claude's replies. */
      history: Record<string, Run>
      /** Agent tool call id → the subagent id it started. */
      cards: Record<string, string>
      /** The agent whose delete waits on a confirming press. */
      confirming: string | null
      /** The agent whose ⋯ menu (Rename, Delete) is open in the list. */
      menuOpen: string | null
      /** The agent being renamed in place in the list. */
      renaming: string | null
      /** True while the list's + menu (New agent, Edit agents) is open. */
      isAdding: boolean
      /** Agent id → how many rows the filled pane's history is scrolled back from the newest. */
      historyBack: Record<string, number>
      /** Agent tool call id → true for a delegated-work card the person unfolded. */
      expanded: Record<string, true>
    }
  }
}
