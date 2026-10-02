import type {
  BaselineStaleAnchor,
  ChangeAnchor,
  ChangeKind,
  Decision,
  DraftChange,
  EntityValue,
  JournalEntry,
  MergeItem,
  PendingDraft,
  ScoreComment,
  ScoreNote,
  Track,
} from '../types'

export type { MergeItem }

export const ENTITY_FIELD = '__entity__'
const NOTE_FIELDS: { key: keyof ScoreNote; label: string }[] = [
  { key: 'key', label: '音高' },
  { key: 'duration', label: '时值' },
  { key: 'accidental', label: '临时记号' },
  { key: 'dynamic', label: '力度' },
  { key: 'tie', label: '延音线' },
  { key: 'expression', label: '表情' },
]
const COMMENT_FIELDS: { key: keyof ScoreComment; label: string }[] = [
  { key: 'content', label: '评论内容' },
  { key: 'resolved', label: '处理结论' },
]

export function timeText(time: number): string {
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
export function fullTimeText(time: number): string {
  return new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function noteMeasure(index: number): number { return Math.floor(index / 4) + 1 }
export function noteBeat(index: number): number { return (index % 4) + 1 }

export function anchorKey(anchor: ChangeAnchor, field: string): string {
  return `${anchor.kind}:${anchor.trackId ?? '-'}:${anchor.noteId ?? anchor.commentId ?? '-'}:${field}`
}

export function anchorText(anchor: ChangeAnchor, tracks: Track[]): string {
  const track = tracks.find((item) => item.id === anchor.trackId)
  const head = track ? `${track.name}` : anchor.kind === 'comment' ? '评论' : '声部'
  if (anchor.kind === 'note') {
    const index = track?.notes.findIndex((note) => note.id === anchor.noteId) ?? -1
    return `${head}${index >= 0 ? ` 第 ${noteMeasure(index)} 小节第 ${noteBeat(index)} 拍` : ''}`
  }
  if (anchor.kind === 'comment') {
    const comment = anchor.commentId
    return `评论 ${comment ?? ''}`
  }
  return head
}

export function fieldLabel(kind: ChangeKind, field: string): string {
  if (field === ENTITY_FIELD) return '增删'
  if (kind === 'note') return NOTE_FIELDS.find((item) => item.key === field)?.label ?? field
  if (kind === 'comment') return COMMENT_FIELDS.find((item) => item.key === field)?.label ?? field
  if (field === 'transposition') return '移调半音数'
  return field
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || a === '') return b === undefined || b === null || b === ''
  return JSON.stringify(a) === JSON.stringify(b)
}

function changeLabel(anchor: ChangeAnchor, field: string, value: unknown, tracks: Track[], added: boolean): string {
  const where = anchorText(anchor, tracks)
  if (field === ENTITY_FIELD) return added ? `在${where}新增音符` : `删除${where}的音符`
  return `${where} · ${fieldLabel(anchor.kind, field)} → ${formatValue(value)}`
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') {
    const entity = value as EntityValue
    if (entity.op === 'add') return '新增'
    if (entity.op === 'remove') return '删除'
    const note = value as ScoreNote
    if (note.key) return `${note.key.replace('/', '')} ${note.dynamic}`
    const comment = value as ScoreComment
    if (comment.content) return comment.content.slice(0, 24)
  }
  return String(value)
}

/** 草稿相对自己合并基线的全部改动；返回按时间排序的 DraftChange 列表 */
export function diffDraft(draft: PendingDraft, tracks: Track[]): DraftChange[] {
  const changes: DraftChange[] = []
  const push = (anchor: ChangeAnchor, field: string, oldValue: unknown, newValue: unknown, index: number, time: number) => {
    const added = typeof newValue === 'object' && newValue !== null && (newValue as EntityValue).op === 'add'
    changes.push({
      id: `${draft.id}:${anchorKey(anchor, field)}`,
      draftId: draft.id,
      editorId: draft.editorId,
      anchor,
      field,
      oldValue,
      newValue,
      index,
      time,
      label: changeLabel(anchor, field, newValue, tracks, added),
    })
  }

  draft.baseTracks.forEach((baseTrack) => {
    const workTrack = draft.tracks.find((item) => item.id === baseTrack.id)
    const anchor0: ChangeAnchor = { kind: 'track', trackId: baseTrack.id }
    if (!workTrack) {
      push(anchor0, ENTITY_FIELD, undefined, { op: 'remove', snapshot: baseTrack } satisfies EntityValue, 0, draft.updatedAt)
      return
    }
    if (workTrack.transposition !== baseTrack.transposition) {
      push(anchor0, 'transposition', baseTrack.transposition, workTrack.transposition, 0, draft.updatedAt)
    }
    const workById = new Map(workTrack.notes.map((note, index) => [note.id, { note, index }]))
    const baseById = new Map(baseTrack.notes.map((note, index) => [note.id, { note, index }]))
    baseTrack.notes.forEach((baseNote, index) => {
      const anchor: ChangeAnchor = { kind: 'note', trackId: baseTrack.id, noteId: baseNote.id }
      const found = workById.get(baseNote.id)
      if (!found) {
        push(anchor, ENTITY_FIELD, { op: 'add', snapshot: baseNote } satisfies EntityValue, { op: 'remove', index } satisfies EntityValue, index, draft.updatedAt)
        return
      }
      NOTE_FIELDS.forEach(({ key }) => {
        if (!sameValue(baseNote[key], found.note[key])) {
          push(anchor, key, baseNote[key], found.note[key], found.index, draft.updatedAt)
        }
      })
    })
    workTrack.notes.forEach((workNote, index) => {
      if (!baseById.has(workNote.id)) {
        const anchor: ChangeAnchor = { kind: 'note', trackId: baseTrack.id, noteId: workNote.id }
        push(anchor, ENTITY_FIELD, undefined, { op: 'add', index, snapshot: workNote } satisfies EntityValue, index, draft.updatedAt)
      }
    })
  })
  draft.tracks.forEach((workTrack) => {
    if (!draft.baseTracks.some((item) => item.id === workTrack.id)) {
      push({ kind: 'track', trackId: workTrack.id }, ENTITY_FIELD, undefined, { op: 'add', snapshot: workTrack } satisfies EntityValue, 0, draft.updatedAt)
    }
  })

  const baseCommentsById = new Map(draft.baseComments.map((comment) => [comment.id, comment]))
  const workCommentsById = new Map(draft.comments.map((comment) => [comment.id, comment]))
  draft.baseComments.forEach((baseComment, index) => {
    const anchor: ChangeAnchor = { kind: 'comment', commentId: baseComment.id }
    const workComment = workCommentsById.get(baseComment.id)
    if (!workComment) {
      push(anchor, ENTITY_FIELD, { op: 'add', snapshot: baseComment } satisfies EntityValue, { op: 'remove', index } satisfies EntityValue, index, draft.updatedAt)
      return
    }
    COMMENT_FIELDS.forEach(({ key }) => {
      if (!sameValue(baseComment[key], workComment[key])) {
        push(anchor, key, baseComment[key], workComment[key], index, draft.updatedAt)
      }
    })
  })
  draft.comments.forEach((workComment, index) => {
    if (!baseCommentsById.has(workComment.id)) {
      push({ kind: 'comment', commentId: workComment.id }, ENTITY_FIELD, undefined, { op: 'add', index, snapshot: workComment } satisfies EntityValue, index, draft.updatedAt)
    }
  })

  changes.sort((a, b) => a.time - b.time || a.index - b.index)
  return changes
}

function resolveValue(item: Pick<MergeItem, 'changes' | 'canonicalValue' | 'baseValue'>, changeId?: string): unknown {
  if (changeId) {
    const change = item.changes.find((candidate) => candidate.id === changeId)
    if (change) return change.newValue
  }
  return item.changes[0]?.newValue ?? item.canonicalValue ?? item.baseValue
}

/**
 * 构建逐项合并队列：把所有草稿改动按（锚点 × 字段）归组。
 * - 仅一方相对基线改动：clean
 * - 多方改动且新值不一致（或与已合并总谱不一致）：conflict，必须显式选边
 * - 锚点实体在总谱已被删除/尚不存在：blocked，不能自动落入
 */
export function buildMergeQueue(
  drafts: PendingDraft[],
  canonicalTracks: Track[],
  canonicalComments: ScoreComment[],
  decisions: Record<string, Decision>,
): MergeItem[] {
  const groups = new Map<string, { anchor: ChangeAnchor; field: string; changes: DraftChange[] }>()
  drafts.forEach((draft) => {
    const feed = (changes: DraftChange[]) => changes.forEach((change) => {
      const key = anchorKey(change.anchor, change.field)
      const group = groups.get(key)
      if (group) group.changes.push(change)
      else groups.set(key, { anchor: change.anchor, field: change.field, changes: [change] })
    })
    feed(diffDraft(draft, canonicalTracks))
    feed(structuredClone(draft.rebaseConflicts ?? []))
  })

  const items: MergeItem[] = []
  groups.forEach((group, key) => {
    const { anchor, field, changes } = group
    let baseValue: unknown
    let canonicalValue: unknown
    let canonicalMissing = false

    if (anchor.kind === 'note') {
      const track = canonicalTracks.find((item) => item.id === anchor.trackId)
      const baseTrack = drafts.find((draft) => draft.baseTracks.some((item) => item.id === anchor.trackId))?.baseTracks.find((item) => item.id === anchor.trackId)
      const note = track?.notes.find((item) => item.id === anchor.noteId)
      const baseNote = baseTrack?.notes.find((item) => item.id === anchor.noteId)
      if (field === ENTITY_FIELD) {
        canonicalValue = track && !note ? { op: 'remove' } : note ? { op: 'exists' } : undefined
        baseValue = { op: baseNote ? 'exists' : 'add' }
        if (!track) canonicalMissing = true
      } else {
        canonicalValue = note?.[field as keyof ScoreNote]
        baseValue = baseNote?.[field as keyof ScoreNote]
        canonicalMissing = !note || !track
      }
    } else if (anchor.kind === 'comment') {
      const comment = canonicalComments.find((item) => item.id === anchor.commentId)
      if (field === ENTITY_FIELD) {
        canonicalValue = comment ? { op: 'exists' } : { op: 'remove' }
        baseValue = { op: 'exists' }
        canonicalMissing = !comment && changes.every((change) => (change.newValue as EntityValue).op !== 'add')
      } else {
        canonicalValue = comment?.[field as keyof ScoreComment]
        baseValue = drafts[0]?.baseComments.find((item) => item.id === anchor.commentId)?.[field as keyof ScoreComment]
        canonicalMissing = !comment
      }
    } else {
      const track = canonicalTracks.find((item) => item.id === anchor.trackId)
      canonicalValue = track?.transposition
      baseValue = drafts[0]?.baseTracks.find((item) => item.id === anchor.trackId)?.transposition
      canonicalMissing = !track
    }

    const reasons: string[] = []
    const distinct = new Map<string, DraftChange>()
    changes.forEach((change) => {
      const signature = JSON.stringify(change.newValue)
      if (!distinct.has(signature)) distinct.set(signature, change)
    })
    const requiresDecision = changes.filter((change) => change.source !== 'merged')
    let isConflict: boolean
    if (field === ENTITY_FIELD) {
      const ops = changes.map((change) => (change.newValue as EntityValue).op)
      isConflict = new Set(ops).size > 1 || (ops[0] === 'add' && distinct.size > 1)
    } else {
      // 草稿新值之间不同，或草稿新值与“他人已合并结果（merged 伪改动）”不同 → 冲突
      isConflict = distinct.size > 1
    }
    if (changes.some((change) => change.source === 'merged')) reasons.push('该锚点已被先前合并改动，草稿尚未见过该结果')
    if (distinct.size > 1 && !reasons.length) reasons.push('多位编辑对同一锚点给出了不同结果')
    if (canonicalMissing) reasons.push(field === ENTITY_FIELD ? '目标声部或锚点实体在总谱中不存在' : '锚点音符或评论已不在总谱中')

    const decidedChanges = changes.map((change) => ({ ...change, decision: decisions[change.id] }))
    const acceptedChange = decidedChanges.find((change) => change.decision === 'accepted')
    const decided = requiresDecision.length === 0
      ? false
      : requiresDecision.every((change) => decidedChanges.find((candidate) => candidate.id === change.id)?.decision !== undefined)
    const accepted = !!acceptedChange

    items.push({
      id: key,
      anchor,
      kind: anchor.kind,
      field,
      trackId: anchor.trackId,
      noteId: anchor.noteId,
      commentId: anchor.commentId,
      label: anchorText(anchor, canonicalTracks),
      fieldLabel: fieldLabel(anchor.kind, field),
      baseValue,
      canonicalValue,
      canonicalMissing,
      changes: decidedChanges.sort((a, b) => b.time - a.time),
      status: canonicalMissing && field !== ENTITY_FIELD ? 'blocked' : isConflict ? 'conflict' : 'clean',
      reasons,
      decided,
      accepted,
    })
  })

  return items.sort((a, b) => {
    const weight = { conflict: 0, blocked: 1, clean: 2 } as const
    return weight[a.status] - weight[b.status] || a.id.localeCompare(b.id)
  })
}

/** 把已决定的队列项真正落到总谱上（纯函数，返回新总谱/评论） */
export function applyItems(
  canonicalTracksInput: Track[],
  canonicalCommentsInput: ScoreComment[],
  items: MergeItem[],
): { tracks: Track[]; comments: ScoreComment[]; acceptedItems: MergeItem[] } {
  const tracks = structuredClone(canonicalTracksInput)
  const comments = structuredClone(canonicalCommentsInput)
  const acceptedItems = items.filter((item) => item.decided && item.accepted)

  // 先处理增删，再处理字段
  acceptedItems.filter((item) => item.field === ENTITY_FIELD).forEach((item) => applyEntity(tracks, comments, item))
  acceptedItems.filter((item) => item.field !== ENTITY_FIELD).forEach((item) => applyField(tracks, comments, item))

  return { tracks, comments, acceptedItems }
}

function acceptedChangeOf(item: MergeItem) {
  return item.changes.find((change) => change.decision === 'accepted')
}

function applyEntity(tracks: Track[], comments: ScoreComment[], item: MergeItem) {
  const change = acceptedChangeOf(item)
  if (!change) return
  const payload = change.newValue as EntityValue
  if (item.kind === 'note') {
    const track = tracks.find((candidate) => candidate.id === item.trackId)
    if (!track) return
    if (payload.op === 'add') {
      const snapshot = payload.snapshot as ScoreNote | undefined
      if (snapshot && !track.notes.some((note) => note.id === snapshot.id)) {
        track.notes.splice(Math.min(payload.index ?? track.notes.length, track.notes.length), 0, structuredClone(snapshot))
      }
    } else {
      const index = track.notes.findIndex((note) => note.id === item.noteId)
      if (index >= 0) track.notes.splice(index, 1)
    }
  } else if (item.kind === 'comment') {
    if (payload.op === 'add') {
      const snapshot = payload.snapshot as ScoreComment | undefined
      if (snapshot && !comments.some((comment) => comment.id === snapshot.id)) comments.push(structuredClone(snapshot))
    } else {
      const index = comments.findIndex((comment) => comment.id === item.commentId)
      if (index >= 0) comments.splice(index, 1)
    }
  }
}

function applyField(tracks: Track[], comments: ScoreComment[], item: MergeItem) {
  const change = acceptedChangeOf(item)
  if (!change) return
  const value = change.newValue
  if (item.kind === 'note') {
    const note = tracks.find((track) => track.id === item.trackId)?.notes.find((candidate) => candidate.id === item.noteId)
    if (note) (note as unknown as Record<string, unknown>)[item.field] = structuredClone(value)
  } else if (item.kind === 'comment') {
    const comment = comments.find((candidate) => candidate.id === item.commentId)
    if (comment) (comment as unknown as Record<string, unknown>)[item.field] = structuredClone(value)
  } else {
    const track = tracks.find((candidate) => candidate.id === item.trackId)
    if (track && item.field === 'transposition') track.transposition = value as number
  }
}

/**
 * 合并后把某份草稿 rebase 到新总谱。
 * @param acceptedKeys   本轮实际落入总谱（被接受）的锚点字段集合
 * @param ownDecidedKeys 本草稿本轮被显式决定（接受或拒绝）的锚点字段集合
 * 规则：
 * - 本草稿已决定的锚点（无论接受/拒绝）→ 工作区直接跟随新总谱（拒绝即放弃本草稿值）
 * - 总谱被他人改、本草稿没碰 → 被动跟随
 * - 总谱被他人改、本草稿有独立改动且不同 → 保留草稿值，并生成「已合并结果 vs 草稿值」一对伪冲突，
 *   下一轮合并队列显式标冲突，不静默覆盖任何一方
 */
export function rebaseDraft(
  draft: PendingDraft,
  prevCanonicalTracks: Track[],
  prevCanonicalComments: ScoreComment[],
  nextCanonicalTracks: Track[],
  nextCanonicalComments: ScoreComment[],
  acceptedKeys: ReadonlySet<string>,
  ownDecidedKeys: ReadonlySet<string>,
  editorNameBy: (id: string) => string,
): PendingDraft {
  const rebased: PendingDraft = {
    ...structuredClone(draft),
    baseTracks: structuredClone(nextCanonicalTracks),
    baseComments: structuredClone(nextCanonicalComments),
    rebaseConflicts: [],
  }
  const pseudo: DraftChange[] = []

  nextCanonicalTracks.forEach((canonicalTrack) => {
    let workTrack = rebased.tracks.find((item) => item.id === canonicalTrack.id)
    if (!workTrack) {
      rebased.tracks.push(structuredClone(canonicalTrack))
      return
    }
    const prevTrack = prevCanonicalTracks.find((item) => item.id === canonicalTrack.id)
    const trackAnchor = { kind: 'track', trackId: canonicalTrack.id } as ChangeAnchor
    const trackKey = anchorKey(trackAnchor, 'transposition')

    if (prevTrack && prevTrack.transposition !== canonicalTrack.transposition) {
      if (ownDecidedKeys.has(trackKey) || workTrack.transposition === prevTrack.transposition) {
        workTrack.transposition = canonicalTrack.transposition
      } else if (workTrack.transposition !== canonicalTrack.transposition) {
        addPseudoConflict(pseudo, draft, trackAnchor, 'transposition', prevTrack.transposition, canonicalTrack.transposition, workTrack.transposition, editorNameBy(canonicalTrack.id), nextCanonicalTracks)
      }
    }

    canonicalTrack.notes.forEach((canonicalNote, index) => {
      const anchor = { kind: 'note', trackId: canonicalTrack.id, noteId: canonicalNote.id } as ChangeAnchor
      let workNote = workTrack!.notes.find((item) => item.id === canonicalNote.id)
      const prevNote = prevTrack?.notes.find((item) => item.id === canonicalNote.id)
      if (!prevNote) {
        // 总谱新增的音符：所有草稿被动接收（若本草稿没有）
        if (!workNote) workTrack!.notes.splice(Math.min(index, workTrack!.notes.length), 0, structuredClone(canonicalNote))
        return
      }
      if (!workNote) {
        // 草稿本地已删除：若该删除被本草稿显式决定则跟随删除；否则保留删除分歧待下轮
        if (ownDecidedKeys.has(anchorKey(anchor, ENTITY_FIELD))) return
        addPseudoConflict(pseudo, draft, anchor, ENTITY_FIELD, undefined,
          { op: 'exists' } satisfies EntityValue, { op: 'remove' } satisfies EntityValue, editorNameBy(canonicalTrack.id), nextCanonicalTracks)
        return
      }
      NOTE_FIELDS.forEach(({ key }) => {
        const keyId = anchorKey(anchor, key)
        if (ownDecidedKeys.has(keyId)) {
          (workNote as unknown as Record<string, unknown>)[key] = structuredClone(canonicalNote[key])
        } else if (acceptedKeys.has(keyId)) {
          if (sameValue(workNote[key], prevNote[key])) {
            (workNote as unknown as Record<string, unknown>)[key] = structuredClone(canonicalNote[key])
          } else if (!sameValue(workNote[key], canonicalNote[key])) {
            addPseudoConflict(pseudo, draft, anchor, key, prevNote[key], canonicalNote[key], workNote[key], editorNameBy(canonicalTrack.id), nextCanonicalTracks)
          }
        }
      })
    })
    // 总谱已删除的音符：若本草稿仍持有且非本草稿决定删除，则保留（其分歧由伪冲突表达）
    workTrack.notes = workTrack.notes.filter((workNote) => {
      if (canonicalTrack.notes.some((note) => note.id === workNote.id)) return true
      return !ownDecidedKeys.has(anchorKey({ kind: 'note', trackId: canonicalTrack.id, noteId: workNote.id }, ENTITY_FIELD))
    })
  })

  nextCanonicalComments.forEach((canonicalComment) => {
    const anchor = { kind: 'comment', commentId: canonicalComment.id } as ChangeAnchor
    let workComment = rebased.comments.find((item) => item.id === canonicalComment.id)
    const prevComment = prevCanonicalComments.find((item) => item.id === canonicalComment.id)
    if (!prevComment) {
      if (!workComment) rebased.comments.push(structuredClone(canonicalComment))
      return
    }
    if (!workComment) return
    COMMENT_FIELDS.forEach(({ key }) => {
      const keyId = anchorKey(anchor, key)
      if (ownDecidedKeys.has(keyId)) {
        (workComment as unknown as Record<string, unknown>)[key] = structuredClone(canonicalComment[key])
      } else if (acceptedKeys.has(keyId)) {
        if (sameValue(workComment[key], prevComment[key])) {
          (workComment as unknown as Record<string, unknown>)[key] = structuredClone(canonicalComment[key])
        } else if (!sameValue(workComment[key], canonicalComment[key])) {
          addPseudoConflict(pseudo, draft, anchor, key, prevComment[key], canonicalComment[key], workComment[key], '', nextCanonicalTracks)
        }
      }
    })
  })

  rebased.rebaseConflicts = pseudo
  return rebased
}

function addPseudoConflict(
  list: DraftChange[],
  draft: PendingDraft,
  anchor: ChangeAnchor,
  field: string,
  _oldValue: unknown,
  mergedValue: unknown,
  draftValue: unknown,
  trackOwnerName: string,
  tracks: Track[],
) {
  const base = {
    draftId: draft.id,
    editorId: draft.editorId,
    anchor,
    field,
    index: 0,
    time: Date.now(),
  }
  list.push({
    ...base,
    id: `${draft.id}:merged:${anchorKey(anchor, field)}`,
    oldValue: _oldValue,
    newValue: mergedValue,
    source: 'merged',
    label: `出版已合并的结果（${fieldLabel(anchor.kind, field)} → ${formatValue(mergedValue)}）`,
  })
  list.push({
    ...base,
    id: `${draft.id}:keep:${anchorKey(anchor, field)}`,
    oldValue: mergedValue,
    newValue: draftValue,
    source: 'draft',
    label: `${draft.editorName}草稿保留值（${fieldLabel(anchor.kind, field)} → ${formatValue(draftValue)}）${anchor.kind === 'track' ? `，${trackOwnerName}` : ''} · ${anchorText(anchor, tracks)}`,
  })
}

/** 旧基线相对新总谱重算：返回失效锚点清单 */
export function diffBaseline(baseline: { trackNotes: Record<string, ScoreNote[]>; trackTranspositions: Record<string, number>; comments: ScoreComment[] }, tracks: Track[], comments: ScoreComment[]): BaselineStaleAnchor[] {
  const stale: BaselineStaleAnchor[] = []
  tracks.forEach((track) => {
    const baseNotes = baseline.trackNotes[track.id]
    if (baseNotes && track.transposition !== (baseline.trackTranspositions[track.id] ?? 0)) {
      stale.push({ anchor: { kind: 'track', trackId: track.id }, label: `${track.name} 移调`, detail: `${baseline.trackTranspositions[track.id] ?? 0} → ${track.transposition} 半音` })
    }
    if (!baseNotes) {
      stale.push({ anchor: { kind: 'track', trackId: track.id }, label: `${track.name}`, detail: '基线中不存在该声部' })
      return
    }
    const baseById = new Map(baseNotes.map((note) => [note.id, note]))
    track.notes.forEach((note, index) => {
      const baseNote = baseById.get(note.id)
      if (!baseNote) {
        stale.push({ anchor: { kind: 'note', trackId: track.id, noteId: note.id }, label: `${track.name} 第 ${noteMeasure(index)} 小节`, detail: '基线后新增音符' })
        return
      }
      NOTE_FIELDS.forEach(({ key, label }) => {
        if (!sameValue(baseNote[key], note[key])) {
          stale.push({ anchor: { kind: 'note', trackId: track.id, noteId: note.id }, label: `${track.name} 第 ${noteMeasure(index)} 小节`, detail: `${label}：${formatValue(baseNote[key])} → ${formatValue(note[key])}` })
        }
      })
    })
    baseNotes.forEach((baseNote) => {
      if (!track.notes.some((note) => note.id === baseNote.id)) {
        stale.push({ anchor: { kind: 'note', trackId: track.id, noteId: baseNote.id }, label: track.name, detail: `音符 ${baseNote.key.replace('/', '')} 已删除` })
      }
    })
  })
  comments.forEach((comment) => {
    const baseComment = baseline.comments.find((item) => item.id === comment.id)
    if (!baseComment) {
      stale.push({ anchor: { kind: 'comment', commentId: comment.id }, label: `第 ${comment.measure} 小节评论`, detail: '基线后新增评论' })
      return
    }
    if (baseComment.resolved !== comment.resolved || baseComment.content !== comment.content) {
      stale.push({ anchor: { kind: 'comment', commentId: comment.id }, label: `第 ${comment.measure} 小节评论`, detail: '处理结论或内容已变化' })
    }
  })
  return stale
}

/** 受失效锚点影响的小节（用于评论结论失效） */
export function affectedMeasures(anchors: BaselineStaleAnchor[], tracks: Track[]): number[] {
  const measures = new Set<number>()
  anchors.forEach(({ anchor }) => {
    if (anchor.kind === 'note') {
      const track = tracks.find((item) => item.id === anchor.trackId)
      const index = track?.notes.findIndex((note) => note.id === anchor.noteId) ?? -1
      if (index >= 0) measures.add(noteMeasure(index))
    } else if (anchor.kind === 'comment') {
      // 评论锚点失效时取评论原小节，调用方在有 comments 时补充
    }
  })
  return [...measures].sort((a, b) => a - b)
}

/** 草稿对每个声部的影响摘要（分谱页使用） */
export interface TrackImpact {
  trackId: Track['id']
  noteChanged: number
  noteAdded: number
  noteRemoved: number
  conflicts: number
  pending: number
  editorIds: string[]
}

export function trackImpacts(drafts: PendingDraft[], canonicalTracks: Track[], canonicalComments: ScoreComment[]): TrackImpact[] {
  const queue = buildMergeQueue(drafts, canonicalTracks, canonicalComments, {})
  return canonicalTracks.map((track) => {
    const items = queue.filter((item) => item.trackId === track.id)
    const noteItems = items.filter((item) => item.kind === 'note')
    return {
      trackId: track.id,
      noteChanged: noteItems.filter((item) => item.field !== ENTITY_FIELD).length,
      noteAdded: noteItems.filter((item) => item.field === ENTITY_FIELD && (item.changes[0]?.newValue as EntityValue)?.op === 'add').length,
      noteRemoved: noteItems.filter((item) => item.field === ENTITY_FIELD && (item.changes[0]?.newValue as EntityValue)?.op === 'remove').length,
      conflicts: items.filter((item) => item.status === 'conflict' || item.status === 'blocked').length,
      pending: items.length,
      editorIds: [...new Set(items.flatMap((item) => item.changes.map((change) => change.editorId)))],
    }
  })
}

export function journalSummary(entries: JournalEntry[]): string {
  return entries.map((entry) => entry.label).join('；')
}

export type { Decision }
