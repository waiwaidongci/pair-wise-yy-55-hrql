export interface ScoreNote {
  id: string
  key: string
  duration: 'q' | 'h' | '8'
  accidental?: '#' | 'b' | 'n'
  dynamic: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
  tie: boolean
  expression: string
}

export interface Track {
  id: string
  name: string
  instrument: string
  clef: 'treble' | 'bass' | 'alto'
  transposition: number
  color: string
  notes: ScoreNote[]
}

export interface ScoreComment {
  id: string
  measure: number
  author: string
  content: string
  resolved: boolean
  invalidated?: boolean
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  trackNotes: Record<string, ScoreNote[]>
}

export interface EditorProfile {
  id: string
  name: string
  role: string
}

export type DraftAnchorType = 'note' | 'comment' | 'track'

export interface DraftChangeLogEntry {
  anchorType: DraftAnchorType
  anchorId: string
  trackId?: string
  field: string
  from: unknown
  to: unknown
  time: string
}

export interface EditorDraft {
  id: string
  editorId: string
  editorName: string
  savedAt: string
  basedOnBaselineId: string | null
  tracks: Track[]
  comments: ScoreComment[]
  changeLog: DraftChangeLogEntry[]
  resolutions: Record<string, 'accepted' | 'rejected'>
  status: 'pending' | 'merged' | 'rejected'
}

export interface BaselineSnapshot {
  id: string
  label: string
  lockedAt: string
  tracks: Track[]
  comments: ScoreComment[]
  resolvedAtLock: string[]
}

export interface RecoveryNotice {
  id: string
  type: 'recovery' | 'migration'
  title: string
  description: string
  lostItems?: string[]
  preservedNotes?: number
  preservedComments?: number
  time: string
}
