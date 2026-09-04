import type { XYPosition } from '@xyflow/react'

/**
 * What the user is currently doing on the canvas, beyond just looking at it.
 * A single union (rather than separate booleans/slots per gesture) makes the
 * mutually-exclusive states structurally mutually exclusive - you can't have a
 * draft note AND a pending connection open at once, because there is only one
 * `interaction` value.
 */
export type Interaction =
  IdleInteraction | DraftInteraction | ConnectingInteraction | EditInteraction | SearchInteraction

export interface IdleInteraction {
  type: 'idle'
}

export interface DraftInteraction {
  type: 'draft'
  clientId: string
  /** Note this draft will be connected from, or null for a freestanding/unconnected note. */
  sourceFilename: string | null
  position: XYPosition
}

export interface ConnectingInteraction {
  type: 'connecting'
  source: string
  target: string
}

export interface EditInteraction {
  type: 'edit'
  filename: string
}

export interface SearchInteraction {
  type: 'search'
  /** Viewport (clientX/clientY) coordinates of the right-click that opened this menu. */
  screenPosition: { x: number; y: number }
}

export const IDLE_INTERACTION: Interaction = { type: 'idle' }

/** Draft/edit client ids are prefixed so the layout/drag layers can skip them. */
export const DRAFT_ID_PREFIX = 'draft:'
