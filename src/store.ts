import { configureStore, createSlice, current, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type {
  Decision,
  EditorId,
  MergeLogEntry,
  PendingDraft,
  PublishingBaseline,
  RecoveryReport,
  ScoreComment,
  ScoreNote,
  ScoreVersion,
  Track,
} from './types'
import { buildSeedBaseline, buildSeedDrafts, editors, seedComments, seedTracks, seedVersions, withSeedJournals } from './mock'
import {
  affectedMeasures,
  anchorKey,
  applyItems,
  buildMergeQueue,
  diffBaseline,
  ENTITY_FIELD,
  fieldLabel,
  formatValue,
  rebaseDraft,
  timeText,
} from './merge/engine'
import { consumeLegacyV1, corruptAllCheckpoints, corruptLatestCheckpoint, loadState, readLegacyV1, saveState } from './merge/storage'

interface ScoreState {
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
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  journalSeq: number
  recoveryReport: RecoveryReport | null
}

const initialDraftJournal = withSeedJournals(buildSeedDrafts())

function initialScoreState(): ScoreState {
  return {
    canonicalTracks: structuredClone(seedTracks),
    comments: structuredClone(seedComments),
    drafts: structuredClone(initialDraftJournal),
    baseline: buildSeedBaseline(),
    decisions: {},
    mergeLog: [],
    versions: structuredClone(seedVersions),
    activeEditor: 'conductor',
    online: false,
    dirty: false,
    selectedTrackId: 'TR-01',
    selectedNoteIndex: 2,
    history: [],
    future: [],
    journalSeq: 3,
    recoveryReport: null,
  }
}

function activeDraft(state: ScoreState): PendingDraft {
  const draft = state.drafts.find((item) => item.editorId === state.activeEditor)
  if (!draft) throw new Error(`缺少编辑草稿：${state.activeEditor}`)
  return draft
}

function persist(state: ScoreState) {
  state.dirty = true
  try { saveState(toPersisted(state)) } catch { /* 配额耗尽或存储不可用时，内存态仍可继续编辑 */ }
}

function toPersisted(state: ScoreState) {
  return {
    version: 2 as const,
    savedAt: Date.now(),
    journalSeq: state.journalSeq,
    canonicalTracks: state.canonicalTracks,
    comments: state.comments,
    drafts: state.drafts,
    baseline: state.baseline,
    decisions: state.decisions,
    mergeLog: state.mergeLog,
    versions: state.versions,
    activeEditor: state.activeEditor,
    online: state.online,
    dirty: state.dirty,
  }
}

function transposeKey(key: string, semitones: number) {
  const chromatic = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}

function snapshotEditor(state: ScoreState) {
  const draft = activeDraft(state)
  state.history.push(JSON.stringify({ tracks: draft.tracks, comments: draft.comments }))
  if (state.history.length > 40) state.history.shift()
  state.future = []
}

function appendJournal(state: ScoreState, label: string, anchorText: string) {
  const draft = activeDraft(state)
  state.journalSeq += 1
  draft.journal.push({ seq: state.journalSeq, time: Date.now(), editorId: draft.editorId, label, anchorText })
  if (draft.journal.length > 200) draft.journal.shift()
  draft.updatedAt = Date.now()
}

function noteAnchorText(track: Track, index: number, field: string, value: unknown): string {
  return `${track.name} 第 ${Math.floor(index / 4) + 1} 小节第 ${(index % 4) + 1} 拍 · ${fieldLabel('note', field)} → ${formatValue(value)}`
}

/** 基线失效：总谱变化后立即比对，标记失效锚点与受影响小节的已解决评论（纯函数） */
function recomputeBaseline(
  baseline: PublishingBaseline | null,
  tracks: Track[],
  comments: ScoreComment[],
): { baseline: PublishingBaseline | null; comments: ScoreComment[]; invalidated: boolean } {
  if (!baseline || baseline.status === 'invalid') return { baseline, comments: structuredClone(comments), invalidated: false }
  const stale = diffBaseline(baseline, tracks, comments)
  if (stale.length === 0) return { baseline, comments: structuredClone(comments), invalidated: false }
  const nextBaseline: PublishingBaseline = { ...baseline, status: 'invalid', invalidatedAt: Date.now(), staleAnchors: stale }
  const measures = new Set(affectedMeasures(stale, tracks))
  stale.forEach(({ anchor }) => {
    if (anchor.kind === 'comment') {
      const comment = comments.find((item) => item.id === anchor.commentId)
      if (comment) measures.add(comment.measure)
    }
  })
  const nextComments = structuredClone(comments)
  nextComments.forEach((comment) => {
    if (comment.resolved && comment.resolvedBaselineId === baseline.id && measures.has(comment.measure)) {
      comment.needsRecheck = true
    }
  })
  return { baseline: nextBaseline, comments: nextComments, invalidated: true }
}

const scoreSlice = createSlice({
  name: 'score',
  initialState: initialScoreState,
  reducers: {
    hydrate(_state, action: PayloadAction<ScoreState>) {
      return action.payload
    },
    setRecoveryReport(state, action: PayloadAction<RecoveryReport | null>) {
      state.recoveryReport = action.payload
    },
    setActiveEditor(state, action: PayloadAction<EditorId>) {
      state.activeEditor = action.payload
      const draft = activeDraft(state)
      state.selectedTrackId = draft.tracks[0]?.id ?? state.selectedTrackId
      state.selectedNoteIndex = 0
      state.history = []
      state.future = []
      persist(state)
    },
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
      persist(state)
    },
    selectTrack(state, action: PayloadAction<string>) { state.selectedTrackId = action.payload; state.selectedNoteIndex = 0 },
    selectNote(state, action: PayloadAction<number>) { state.selectedNoteIndex = action.payload },

    addNote(state) {
      const draft = activeDraft(state)
      snapshotEditor(state)
      const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
      const template = track.notes[Math.min(track.notes.length - 1, state.selectedNoteIndex)]
      const newNote: ScoreNote = { id: `N-${Date.now()}`, key: template?.key ?? 'c/4', duration: 'q', dynamic: template?.dynamic ?? 'mf', tie: false, expression: '' }
      track.notes.splice(state.selectedNoteIndex + 1, 0, newNote)
      state.selectedNoteIndex += 1
      appendJournal(state, `${track.name} 新增音符 ${newNote.key.replace('/', '')}`, `${track.name} 第 ${Math.floor((state.selectedNoteIndex) / 4) + 1} 小节`)
      persist(state)
    },
    removeNote(state) {
      const draft = activeDraft(state)
      snapshotEditor(state)
      const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
      if (track.notes.length <= 1) return
      const removed = track.notes[state.selectedNoteIndex]!
      track.notes.splice(state.selectedNoteIndex, 1)
      state.selectedNoteIndex = Math.max(0, state.selectedNoteIndex - 1)
      appendJournal(state, `${track.name} 删除音符 ${removed.key.replace('/', '')}`, `${track.name}`)
      persist(state)
    },
    updateNote(state, action: PayloadAction<Partial<ScoreNote>>) {
      const draft = activeDraft(state)
      snapshotEditor(state)
      const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
      const note = track.notes[state.selectedNoteIndex]!
      Object.entries(action.payload).forEach(([field, value]) => {
        appendJournal(state, noteAnchorText(track, state.selectedNoteIndex, field, value), `${track.name} 第 ${Math.floor(state.selectedNoteIndex / 4) + 1} 小节`)
      })
      Object.assign(note, action.payload)
      persist(state)
    },
    transposeTrack(state, action: PayloadAction<number>) {
      const draft = activeDraft(state)
      snapshotEditor(state)
      const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
      const delta = action.payload
      if (!delta) return
      track.notes.forEach((note) => { note.key = transposeKey(note.key, delta) })
      track.transposition += delta
      appendJournal(state, `${track.name} ${delta > 0 ? '升' : '降'} ${Math.abs(delta)} 半音（累计 ${track.transposition > 0 ? '+' : ''}${track.transposition}）`, track.name)
      persist(state)
    },
    undo(state) {
      const previous = state.history.pop()
      if (!previous) return
      const draft = activeDraft(state)
      state.future.push(JSON.stringify({ tracks: draft.tracks, comments: draft.comments }))
      const restored = JSON.parse(previous) as { tracks: Track[]; comments: ScoreComment[] }
      draft.tracks = restored.tracks
      draft.comments = restored.comments
      persist(state)
    },
    redo(state) {
      const next = state.future.pop()
      if (!next) return
      const draft = activeDraft(state)
      state.history.push(JSON.stringify({ tracks: draft.tracks, comments: draft.comments }))
      const restored = JSON.parse(next) as { tracks: Track[]; comments: ScoreComment[] }
      draft.tracks = restored.tracks
      draft.comments = restored.comments
      persist(state)
    },

    resolveComment(state, action: PayloadAction<string>) {
      const draft = activeDraft(state)
      snapshotEditor(state)
      const comment = draft.comments.find((item) => item.id === action.payload)
      if (!comment) return
      comment.resolved = true
      comment.resolvedAt = Date.now()
      comment.needsRecheck = false
      appendJournal(state, `标记评论 ${comment.id} 为已处理`, `评论 ${comment.id} · 第 ${comment.measure} 小节`)
      persist(state)
    },
    /** 出版编辑复核后重新确认评论结论 */
    confirmCommentRecheck(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload)
      if (!comment) return
      comment.needsRecheck = false
      comment.resolved = true
      comment.resolvedAt = Date.now()
      comment.resolvedBaselineId = state.baseline?.id
      state.drafts.forEach((draft) => {
        const local = draft.comments.find((item) => item.id === comment.id)
        if (local) { local.needsRecheck = false; local.resolved = true; local.resolvedAt = comment.resolvedAt }
      })
      persist(state)
    },

    setDecision(state, action: PayloadAction<{ changeId: string; decision: Decision | null }>) {
      const next = { ...state.decisions }
      if (action.payload.decision === null) delete next[action.payload.changeId]
      else next[action.payload.changeId] = action.payload.decision
      state.decisions = next
      persist(state)
    },

    /**
     * 网络恢复后由出版编辑逐项合并：
     * 已决定项落入总谱 → 其余草稿 rebase（分歧升级为冲突）→ 旧基线及相关评论结论立即失效重算
     */
    applyMerges(state) {
      // 只有网络恢复后的出版编辑能提交合并；离线/其他身份只能在草稿里预判
      if (!state.online || state.activeEditor !== 'publisher') return
      // 先用 current() 取脱离 Immer 的纯快照，再跑结构化克隆与纯函数合并
      const snap = current(state)
      const rawQueue = buildMergeQueue(snap.drafts, snap.canonicalTracks, snap.comments, snap.decisions)
      // 裁剪上一轮已合并锚点遗留的过期决策，避免污染本轮 accepted 判定
      const validIds = new Set(rawQueue.flatMap((item) => item.changes.map((change) => change.id)))
      const liveDecisions: Record<string, Decision> = Object.fromEntries(Object.entries(snap.decisions).filter(([id]) => validIds.has(id)))
      const queue = buildMergeQueue(snap.drafts, snap.canonicalTracks, snap.comments, liveDecisions)
      const decidedItems = queue.filter((item) => item.decided)
      if (!decidedItems.length) return
      const beforeTracks = structuredClone(snap.canonicalTracks)
      const beforeComments = structuredClone(snap.comments)
      // 一个冲突项可含多条 change（一接受、其余拒绝）；接受/拒绝按 change 粒度统计
      const acceptedChangeCount = decidedItems.reduce((sum, item) => sum + item.changes.filter((change) => change.decision === 'accepted').length, 0)
      const rejectedChangeCount = decidedItems.reduce((sum, item) => sum + item.changes.filter((change) => change.decision === 'rejected').length, 0)
      const acceptedItems = decidedItems.filter((item) => item.accepted)
      const { tracks, comments } = applyItems(beforeTracks, beforeComments, decidedItems)

      const editorNameByTrack = (trackId: string) => tracks.find((item) => item.id === trackId)?.name ?? trackId
      const acceptedKeys = new Set(acceptedItems.map((item) => anchorKey(item.anchor, item.field)))
      const nextDrafts = snap.drafts.map((draft) => {
        // 本草稿本轮被显式决定（接受或拒绝）的锚点字段
        const ownDecidedKeys = new Set(
          decidedItems
            .filter((item) => item.changes.some((change) => change.draftId === draft.id))
            .map((item) => anchorKey(item.anchor, item.field)),
        )
        return rebaseDraft(draft, beforeTracks, beforeComments, tracks, comments, acceptedKeys, ownDecidedKeys, editorNameByTrack)
      })

      const conflictsResolved = decidedItems.filter((item) => item.status === 'conflict').length
      const affectedTrackIds = new Set(acceptedItems.map((item) => item.trackId).filter(Boolean) as string[])
      const measures = new Set<number>()
      acceptedItems.forEach((item) => {
        if (item.kind === 'note') {
          const track = tracks.find((candidate) => candidate.id === item.trackId)
          const index = track?.notes.findIndex((note) => note.id === item.noteId) ?? -1
          if (index >= 0) measures.add(Math.floor(index / 4) + 1)
        }
      })
      const recomputed = recomputeBaseline(snap.baseline, tracks, comments)
      state.canonicalTracks = tracks
      state.comments = recomputed.comments
      state.drafts = nextDrafts
      state.baseline = recomputed.baseline
      const log: MergeLogEntry = {
        id: `M-${Date.now()}`,
        time: Date.now(),
        accepted: acceptedChangeCount,
        rejected: rejectedChangeCount,
        conflictsResolved,
        affectedTracks: [...affectedTrackIds],
        affectedMeasures: [...measures],
        baselineInvalidated: recomputed.invalidated,
        note: `接受 ${acceptedChangeCount} 项、拒绝 ${rejectedChangeCount} 项${recomputed.invalidated ? '，旧出版基线已失效' : ''}`,
      }
      state.mergeLog.unshift(log)

      // 清掉已处理项的决定；rebase 新产生的冲突项保留待下一轮
      const remainingIds = new Set(buildMergeQueue(nextDrafts, tracks, recomputed.comments, {}).flatMap((item) => item.changes.map((change) => change.id)))
      state.decisions = Object.fromEntries(Object.entries(liveDecisions).filter(([id]) => remainingIds.has(id)))
      persist(state)
    },

    /** 出版编辑重锁基线：以当前总谱重新计算指纹，此前的失效结论作废重算起点 */
    lockBaseline(state) {
      const snap = current(state)
      const serial = Math.max(13, ...snap.versions.map((version) => Number(version.id.slice(1)) || 0)) + 1
      const id = `v${serial}`
      const canonicalTracks = structuredClone(snap.canonicalTracks)
      const comments = structuredClone(snap.comments)
      comments.forEach((comment) => {
        if (comment.needsRecheck) return
        if (comment.resolved) comment.resolvedBaselineId = id
      })
      const baseline: PublishingBaseline = {
        id,
        title: `出版稿 ${id}（合并后重锁）`,
        lockedAt: Date.now(),
        lockedBy: editors.find((editor) => editor.id === 'publisher')!.name,
        trackNotes: Object.fromEntries(canonicalTracks.map((track) => [track.id, structuredClone(track.notes)])),
        trackTranspositions: Object.fromEntries(canonicalTracks.map((track) => [track.id, track.transposition])),
        comments: structuredClone(comments),
        status: 'valid',
        staleAnchors: [],
      }
      state.baseline = baseline
      state.versions.unshift({
        id,
        author: '赵晴',
        time: timeText(Date.now()),
        summary: '逐项合并后重锁出版基线，失效评论结论已重算',
        trackNotes: Object.fromEntries(canonicalTracks.map((track) => [track.id, structuredClone(track.notes)])),
      })
      state.comments = comments
      state.drafts = snap.drafts.map((draft) => ({
        ...structuredClone(draft),
        baseTracks: structuredClone(canonicalTracks),
        baseComments: structuredClone(comments),
        tracks: structuredClone(canonicalTracks),
        comments: structuredClone(comments),
        rebaseConflicts: [],
      }))
      state.dirty = false
      persist(state)
    },

    /** v1 旧稿升级：保留原音符与评论，整体作为一个待合并草稿进入队列 */
    importLegacyDraft(state, action: PayloadAction<{ tracks: Track[]; comments: ScoreComment[]; parseWarning?: string }>) {
      const snap = current(state)
      const editor = editors.find((item) => item.id === 'publisher')!
      const id = `draft-legacy-${Date.now()}`
      const draft: PendingDraft = {
        id,
        editorId: 'publisher',
        editorName: `${editor.name}（旧稿升级）`,
        role: '旧版自动保存',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        baseTracks: structuredClone(snap.canonicalTracks),
        baseComments: structuredClone(snap.comments),
        tracks: structuredClone(action.payload.tracks),
        comments: structuredClone(action.payload.comments),
        journal: [{ seq: state.journalSeq + 1, time: Date.now(), editorId: 'publisher', label: `旧稿升级：保留 ${action.payload.tracks.reduce((sum, track) => sum + track.notes.length, 0)} 个原音符、${action.payload.comments.length} 条原评论`, anchorText: 'v1 单键草稿 yy55-score-draft' }],
        rebaseConflicts: [],
      }
      state.journalSeq += 1
      state.drafts.push(draft)
      state.recoveryReport = {
        restoredAt: Date.now(),
        reason: 'legacy-upgrade',
        lostOperations: [],
        legacy: {
          source: 'v1',
          preservedNotes: action.payload.tracks.reduce((sum, track) => sum + track.notes.length, 0),
          preservedComments: action.payload.comments.length,
          draftEditor: draft.editorName,
          parseWarning: action.payload.parseWarning,
        },
        message: `已从旧版自动保存升级：${action.payload.tracks.reduce((sum, track) => sum + track.notes.length, 0)} 个原音符与 ${action.payload.comments.length} 条原评论全部保留，作为「${draft.editorName}」待合并草稿，需逐项合并，不会覆盖当前总谱。`,
      }
      persist(state)
      consumeLegacyV1()
    },

    dismissRecoveryReport(state) {
      state.recoveryReport = null
      persist(state)
    },
  },
})

/** 供 UI 调用：落盘 → 破坏 → 重载 → hydrate */
export const simulateAndReload = (scope: 'latest' | 'all') => (dispatch: AppDispatch, getState: () => RootState) => {
  saveState(toPersisted(getState().score))
  if (scope === 'latest') corruptLatestCheckpoint()
  else corruptAllCheckpoints()
  const { state: loaded, report } = loadState(null)
  if (loaded) {
    dispatch(hydrate({
      ...initialScoreState(),
      canonicalTracks: loaded.canonicalTracks,
      comments: loaded.comments,
      drafts: loaded.drafts,
      baseline: loaded.baseline,
      decisions: loaded.decisions ?? {},
      mergeLog: loaded.mergeLog ?? [],
      versions: loaded.versions ?? initialScoreState().versions,
      activeEditor: loaded.activeEditor ?? 'conductor',
      online: loaded.online ?? false,
      dirty: true,
      journalSeq: loaded.journalSeq ?? 0,
      recoveryReport: report,
    }))
  }
}

/** 启动时恢复：优先三代检查点；检测到 v1 旧稿则升级保留 */
function rehydrate(): ScoreState {
  const base = initialScoreState()
  try {
    const { state: loaded, report } = loadState(null)
    if (loaded) {
      return {
        ...base,
        canonicalTracks: loaded.canonicalTracks,
        comments: loaded.comments,
        drafts: loaded.drafts,
        baseline: loaded.baseline,
        decisions: loaded.decisions ?? {},
        mergeLog: loaded.mergeLog ?? [],
        versions: loaded.versions ?? base.versions,
        activeEditor: loaded.activeEditor ?? 'conductor',
        online: loaded.online ?? false,
        dirty: loaded.dirty ?? false,
        journalSeq: loaded.journalSeq ?? base.journalSeq,
        recoveryReport: report,
      }
    }
  } catch {
    /* 落盘不可用时退回内置排练稿 */
  }

  // 首次使用：检测旧版单键草稿并升级
  try {
    const legacy = readLegacyV1()
    if (legacy && Array.isArray((legacy as { tracks?: unknown[] }).tracks)) {
      const restored = initialScoreState()
      scoreSlice.caseReducers.importLegacyDraft(restored, {
        type: 'score/importLegacyDraft',
        payload: { tracks: legacy.tracks as Track[], comments: (legacy.comments as ScoreComment[]) ?? [] },
      })
      return restored
    }
  } catch {
    /* 旧稿损坏时忽略，使用内置稿；读取失败的提示留给显式模拟入口 */
  }
  return base
}

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({ queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }) }),
  }),
})

export const {
  hydrate, setRecoveryReport, setActiveEditor, setOnline,
  selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo,
  resolveComment, confirmCommentRecheck, setDecision, applyMerges, lockBaseline,
  importLegacyDraft, dismissRecoveryReport,
} = scoreSlice.actions
export { ENTITY_FIELD }

const initialRehydrated = rehydrate()
export const store = configureStore({
  reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer },
  preloadedState: { score: initialRehydrated },
  middleware: (getDefault) => getDefault().concat(scoreApi.middleware),
})

// 启动恢复后立即落盘新一代完整检查点：既修复被回滚的存储，也保证离线第一刻起就有完整草稿
try { saveState(toPersisted(initialRehydrated)) } catch { /* localStorage 不可用时保持内存态 */ }

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
