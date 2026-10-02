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
  resolvedAt?: number
  resolvedBaselineId?: string
  needsRecheck?: boolean
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  trackNotes: Record<string, ScoreNote[]>
}

export type EditorId = 'conductor' | 'publisher' | 'composer'

export interface EditorProfile {
  id: EditorId
  name: string
  role: string
}

export type ChangeKind = 'note' | 'comment' | 'track'

export interface ChangeAnchor {
  kind: ChangeKind
  trackId?: string
  noteId?: string
  commentId?: string
}

/** __entity__ 字段的载荷：整条音符/评论的新增或删除（exists 仅用于比较阶段表示总谱状态） */
export type EntityValue =
  | { op: 'add'; index?: number; snapshot?: unknown }
  | { op: 'remove'; index?: number; snapshot?: unknown }
  | { op: 'exists' }

/** 单个草稿相对其合并基线产生的一处改动；source='merged' 表示 rebase 时发现总谱已被他人合并 */
export interface DraftChange {
  id: string
  draftId: string
  editorId: EditorId
  anchor: ChangeAnchor
  field: string
  oldValue: unknown
  newValue: unknown
  index: number
  time: number
  label: string
  source?: 'draft' | 'merged'
}

export type ItemStatus = 'clean' | 'conflict' | 'blocked'
export type Decision = 'accepted' | 'rejected'

export interface QueueChange extends DraftChange {
  decision?: Decision
}

export interface MergeItem {
  id: string
  anchor: ChangeAnchor
  kind: ChangeKind
  field: string
  trackId?: string
  noteId?: string
  commentId?: string
  label: string
  fieldLabel: string
  baseValue: unknown
  canonicalValue: unknown
  canonicalMissing: boolean
  changes: QueueChange[]
  status: ItemStatus
  reasons: string[]
  decided: boolean
  accepted: boolean
}

export interface JournalEntry {
  seq: number
  time: number
  editorId: EditorId
  label: string
  anchorText: string
}

export interface PendingDraft {
  id: string
  editorId: EditorId
  editorName: string
  role: string
  createdAt: number
  updatedAt: number
  baseTracks: Track[]
  baseComments: ScoreComment[]
  tracks: Track[]
  comments: ScoreComment[]
  journal: JournalEntry[]
  /** rebase 后仍与新总谱冲突的已合并来源项 */
  rebaseConflicts: DraftChange[]
}

export interface BaselineStaleAnchor {
  anchor: ChangeAnchor
  label: string
  detail: string
}

export interface PublishingBaseline {
  id: string
  title: string
  lockedAt: number
  lockedBy: string
  trackNotes: Record<string, ScoreNote[]>
  trackTranspositions: Record<string, number>
  comments: ScoreComment[]
  status: 'valid' | 'invalid'
  invalidatedAt?: number
  staleAnchors: BaselineStaleAnchor[]
}

export interface MergeLogEntry {
  id: string
  time: number
  accepted: number
  rejected: number
  conflictsResolved: number
  affectedTracks: string[]
  affectedMeasures: number[]
  baselineInvalidated: boolean
  note: string
}

export interface LegacyUpgradeInfo {
  source: 'v1'
  preservedNotes: number
  preservedComments: number
  draftEditor: string
  parseWarning?: string
}

export interface RecoveryReport {
  restoredAt: number
  reason: 'corrupt-checkpoint' | 'legacy-upgrade' | 'legacy-unreadable'
  usedSavedAt?: number
  brokenSavedAt?: number
  lostOperations: JournalEntry[]
  legacy?: LegacyUpgradeInfo
  message: string
}

export interface PersistedMergeState {
  version: 2
  savedAt: number
  journalSeq: number
  canonicalTracks: Track[]
  comments: ScoreComment[]
  drafts: PendingDraft[]
  baseline: PublishingBaseline | null
  decisions: Record<string, Decision>
  mergeLog: MergeLogEntry[]
  versions: ScoreVersion[]
  activeEditor: EditorId
  online: boolean
  dirty: boolean
}
