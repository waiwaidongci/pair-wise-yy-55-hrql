import { configureStore, createListenerMiddleware, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaselineSnapshot, DraftChangeLogEntry, EditorDraft, RecoveryNotice, ScoreComment, ScoreNote, Track } from './types'
import { seedComments, seedTracks, seedVersions } from './mock'
import {
  applyValueToWorking,
  buildReview,
  changeKey,
  clearDraftStorage,
  diffComments,
  diffTracks,
  KEY_WORKING,
  loadInitialState,
  logKey,
  persistBaseline,
  persistDraft,
  persistWorking,
} from './publishing'

interface ScoreState {
  tracks: Track[]
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  comments: ScoreComment[]
  versions: typeof seedVersions
  dirty: boolean
  editors: { id: string; name: string; role: string }[]
  currentEditorId: string
  drafts: EditorDraft[]
  baseline: BaselineSnapshot | null
  baselineRev: number
  rev: number
  online: boolean
  recoveryNotices: RecoveryNotice[]
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const initial = loadInitialState()

const initialState: ScoreState = {
  tracks: initial.tracks,
  selectedTrackId: 'TR-01',
  selectedNoteIndex: 2,
  history: [],
  future: [],
  comments: initial.comments,
  versions: clone(seedVersions),
  dirty: false,
  editors: initial.editors,
  currentEditorId: initial.currentEditorId,
  drafts: initial.drafts,
  baseline: initial.baseline,
  baselineRev: 0,
  rev: 0,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  recoveryNotices: initial.recoveryNotices,
}

function snapshot(state: ScoreState, tracks: Track[]) {
  state.history.push(JSON.stringify(tracks))
  if (state.history.length > 40) state.history.shift()
  state.future = []
}

function transposeKey(key: string, semitones: number) {
  const chromatic = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}

function currentEditorName(state: ScoreState): string {
  return state.editors.find((e) => e.id === state.currentEditorId)?.name ?? state.currentEditorId
}

function currentDraft(state: ScoreState): EditorDraft | undefined {
  return state.drafts.find((d) => d.editorId === state.currentEditorId && d.status === 'pending')
}

function ensureDraft(state: ScoreState): EditorDraft {
  let draft = currentDraft(state)
  if (!draft) {
    draft = {
      id: `D-${state.currentEditorId}-${Date.now()}`,
      editorId: state.currentEditorId,
      editorName: currentEditorName(state),
      savedAt: new Date().toISOString(),
      basedOnBaselineId: state.baseline?.id ?? null,
      tracks: clone(state.tracks),
      comments: clone(state.comments),
      changeLog: [],
      resolutions: {},
      status: 'pending',
    }
    state.drafts.push(draft)
  }
  return draft
}

function appendToDraft(state: ScoreState, entries: DraftChangeLogEntry[]) {
  const draft = ensureDraft(state)
  for (const entry of entries) {
    const last = [...draft.changeLog].reverse().find((c) => c.anchorType === entry.anchorType && c.anchorId === entry.anchorId && c.field === entry.field)
    if (last && Object.is(last.to, entry.to)) continue
    draft.changeLog.push(entry)
  }
  draft.savedAt = new Date().toISOString()
  state.dirty = draft.changeLog.length > 0
}

function touch(state: ScoreState) {
  state.rev += 1
}

// 总谱一旦在基线锁定后改动，旧基线失效，基于基线的评论结论立即重算（回到未解决）
function invalidateBaseline(state: ScoreState) {
  if (!state.baseline || state.rev === state.baselineRev) return
  for (const id of state.baseline.resolvedAtLock) {
    const comment = state.comments.find((c) => c.id === id)
    if (comment && comment.resolved) {
      comment.resolved = false
      comment.invalidated = true
    }
  }
}

// 编辑动作先进入当前编辑的待合并草稿（草稿快照独立于工作副本），冲突不在此静默合并
function edit(state: ScoreState, mutate: (draft: EditorDraft) => void) {
  const draft = ensureDraft(state)
  const prevTracks = clone(draft.tracks)
  const prevComments = clone(draft.comments)
  snapshot(state, draft.tracks)
  mutate(draft)
  appendToDraft(state, [...diffTracks(prevTracks, draft.tracks), ...diffComments(prevComments, draft.comments)])
  touch(state)
  invalidateBaseline(state)
}

function finalizeDrafts(state: ScoreState) {
  for (const draft of state.drafts) {
    if (draft.status !== 'pending') continue
    const keys = new Set(draft.changeLog.map(changeKey))
    if (keys.size === 0) continue
    const resolved = [...keys].every((key) => draft.resolutions[key])
    if (!resolved) continue
    draft.status = [...keys].every((key) => draft.resolutions[key] === 'accepted') ? 'merged' : 'rejected'
  }
}

const scoreSlice = createSlice({
  name: 'score',
  initialState,
  reducers: {
    selectTrack(state, action: PayloadAction<string>) { state.selectedTrackId = action.payload; state.selectedNoteIndex = 0 },
    selectNote(state, action: PayloadAction<number>) { state.selectedNoteIndex = action.payload },
    addNote(state) {
      edit(state, (draft) => {
        const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
        const template = track.notes[Math.min(track.notes.length - 1, state.selectedNoteIndex)]
        track.notes.splice(state.selectedNoteIndex + 1, 0, { id: `N-${Date.now()}`, key: template?.key ?? 'c/4', duration: 'q', dynamic: template?.dynamic ?? 'mf', tie: false, expression: '' })
        state.selectedNoteIndex += 1
      })
    },
    removeNote(state) {
      edit(state, (draft) => {
        const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
        if (track.notes.length > 1) track.notes.splice(state.selectedNoteIndex, 1)
        state.selectedNoteIndex = Math.max(0, state.selectedNoteIndex - 1)
      })
    },
    updateNote(state, action: PayloadAction<Partial<ScoreNote>>) {
      edit(state, (draft) => {
        const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
        Object.assign(track.notes[state.selectedNoteIndex]!, action.payload)
      })
    },
    transposeTrack(state, action: PayloadAction<number>) {
      edit(state, (draft) => {
        const track = draft.tracks.find((item) => item.id === state.selectedTrackId)!
        track.notes.forEach((note) => { note.key = transposeKey(note.key, action.payload) })
        track.transposition += action.payload
      })
    },
    resolveComment(state, action: PayloadAction<string>) {
      edit(state, (draft) => {
        const comment = draft.comments.find((item) => item.id === action.payload)
        if (comment) { comment.resolved = true; comment.invalidated = false }
      })
    },
    undo(state) {
      const draft = currentDraft(state)
      if (!draft) return
      const previous = state.history.pop()
      if (!previous) return
      state.future.push(JSON.stringify(draft.tracks))
      draft.tracks = JSON.parse(previous)
      state.dirty = draft.changeLog.length > 0
      touch(state)
      invalidateBaseline(state)
    },
    redo(state) {
      const draft = currentDraft(state)
      if (!draft) return
      const next = state.future.pop()
      if (!next) return
      state.history.push(JSON.stringify(draft.tracks))
      draft.tracks = JSON.parse(next)
      state.dirty = draft.changeLog.length > 0
      touch(state)
      invalidateBaseline(state)
    },
    saveVersion(state) {
      state.versions.unshift({ id: `v${state.versions.length + 13}`, author: '当前用户', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), summary: '保存当前总谱与分谱调整', trackNotes: Object.fromEntries(state.tracks.map((track) => [track.id, clone(track.notes)])) })
      localStorage.removeItem(KEY_WORKING)
    },
    lockBaseline(state) {
      state.baseline = {
        id: `BL-${Date.now()}`,
        label: `出版基线 v${state.versions.length + 1}`,
        lockedAt: new Date().toISOString(),
        tracks: clone(state.tracks),
        comments: clone(state.comments),
        resolvedAtLock: state.comments.filter((c) => c.resolved).map((c) => c.id),
      }
      state.baselineRev = state.rev
      for (const comment of state.comments) comment.invalidated = false
      persistBaseline(state.baseline)
    },
    acceptMergeItem(state, action: PayloadAction<{ key: string; candidateDraftId?: string }>) {
      const review = buildReview(state.drafts, state.tracks, state.comments)
      const item = review.find((entry) => entry.key === action.payload.key)
      if (!item || item.status === 'obsolete' || item.status === 'applied') return
      const candidate = action.payload.candidateDraftId
        ? item.candidates.find((c) => c.draftId === action.payload.candidateDraftId)
        : item.candidates[0]
      if (!candidate) return
      applyValueToWorking(state.tracks, state.comments, state.drafts, item, candidate.value)
      for (const draft of state.drafts) {
        if (draft.status !== 'pending') continue
        if (!draft.changeLog.some((entry) => changeKey(entry) === item.key)) continue
        draft.resolutions[item.key] = draft.id === candidate.draftId ? 'accepted' : 'rejected'
      }
      finalizeDrafts(state)
      touch(state)
      invalidateBaseline(state)
    },
    rejectMergeItem(state, action: PayloadAction<string>) {
      const review = buildReview(state.drafts, state.tracks, state.comments)
      const item = review.find((entry) => entry.key === action.payload)
      if (!item) return
      for (const draft of state.drafts) {
        if (draft.status !== 'pending') continue
        if (draft.changeLog.some((entry) => changeKey(entry) === item.key)) draft.resolutions[item.key] = 'rejected'
      }
      finalizeDrafts(state)
    },
    setCurrentEditor(state, action: PayloadAction<string>) {
      state.currentEditorId = action.payload
      state.history = []
      state.future = []
      state.dirty = false
    },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload },
    dismissNotice(state, action: PayloadAction<string>) { state.recoveryNotices = state.recoveryNotices.filter((notice) => notice.id !== action.payload) },
  },
})

// ---------- 持久化中间件：离线自动保存工作副本与各编辑草稿 ----------

const listenerMiddleware = createListenerMiddleware()
let lastWorkingJson = JSON.stringify({ tracks: initialState.tracks, comments: initialState.comments })

listenerMiddleware.startListening({
  predicate: () => true,
  effect: (_action, api) => {
    const state = (api.getState() as RootState).score
    const workingJson = JSON.stringify({ tracks: state.tracks, comments: state.comments })
    if (workingJson !== lastWorkingJson) {
      persistWorking(state.tracks, state.comments)
      lastWorkingJson = workingJson
    }
    for (const draft of state.drafts) {
      if (draft.status === 'pending') {
        const ok = persistDraft(draft)
        if (!ok) {
          // 写入校验失败：下次启动走恢复流程，这里先记录日志
          console.warn('[publishing] 草稿写入后校验失败：', draft.editorName)
        }
      } else {
        clearDraftStorage(draft.editorId)
      }
    }
  },
})

// 草稿变更日志镜像（用于主草稿损坏后说明丢失范围）
listenerMiddleware.startListening({
  predicate: (action) => action.type.startsWith('score/') && ['score/addNote', 'score/removeNote', 'score/updateNote', 'score/transposeTrack', 'score/resolveComment'].includes(action.type),
  effect: (_action, api) => {
    const state = (api.getState() as RootState).score
    const draft = state.drafts.find((d) => d.editorId === state.currentEditorId && d.status === 'pending')
    if (draft) {
      try { localStorage.setItem(logKey(draft.editorId), JSON.stringify(draft.changeLog.slice(-200))) } catch { /* ignore */ }
    }
  },
})

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({ queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }) }),
  }),
})

export const {
  selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo,
  resolveComment, saveVersion, lockBaseline, acceptMergeItem, rejectMergeItem,
  setCurrentEditor, setOnline, dismissNotice,
} = scoreSlice.actions

export const store = configureStore({
  reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer },
  middleware: (getDefault) => getDefault().concat(scoreApi.middleware).concat(listenerMiddleware.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// ---------- 选择器 ----------

const selectScore = (state: RootState) => state.score

export const selectReview = createSelector([selectScore], (score) => buildReview(score.drafts, score.tracks, score.comments))

// 总谱编辑视图：显示当前编辑的待合并草稿快照；无草稿时显示工作副本
export const selectScoreView = createSelector([selectScore], (score) => {
  const draft = score.drafts.find((d) => d.editorId === score.currentEditorId && d.status === 'pending')
  return {
    tracks: draft?.tracks ?? score.tracks,
    history: score.history,
    future: score.future,
    dirty: draft ? draft.changeLog.length > 0 : false,
    isDraft: !!draft,
    draftEditorName: draft?.editorName,
  }
})

export const selectPendingDrafts = createSelector([selectScore], (score) => score.drafts.filter((d) => d.status === 'pending'))

export const selectBaselineStale = createSelector(
  [selectScore],
  (score) => score.baseline !== null && score.rev !== score.baselineRev,
)

export interface AffectedPart {
  noteChanges: { entry: DraftChangeLogEntry; measure?: number }[]
  commentCount: number
  editors: string[]
}

export const selectAffectedParts = createSelector([selectScore], (score) => {
  const result: Record<string, AffectedPart> = {}
  const ensure = (trackId: string): AffectedPart => (result[trackId] ??= { noteChanges: [], commentCount: 0, editors: [] })
  const locateNote = (anchorId: string, trackId?: string): { trackId: string; measure?: number } | undefined => {
    const search = (trackList: Track[]) => {
      for (const t of trackList) {
        if (trackId && t.id !== trackId) continue
        const idx = t.notes.findIndex((n) => n.id === anchorId)
        if (idx >= 0) return { trackId: t.id, measure: Math.floor(idx / 4) + 1 }
      }
      return undefined
    }
    for (const draft of score.drafts) {
      const found = search(draft.tracks)
      if (found) return found
    }
    return search(score.tracks)
  }
  const allTrackIds = (): string[] => {
    const ids = new Set<string>()
    for (const draft of score.drafts) draft.tracks.forEach((t) => ids.add(t.id))
    score.tracks.forEach((t) => ids.add(t.id))
    return [...ids]
  }
  for (const draft of score.drafts.filter((d) => d.status === 'pending')) {
    for (const entry of draft.changeLog) {
      if (entry.anchorType === 'note') {
        const located = locateNote(entry.anchorId, entry.trackId)
        if (!located) continue
        const part = ensure(located.trackId)
        part.noteChanges.push({ entry, measure: located.measure })
        if (!part.editors.includes(draft.editorName)) part.editors.push(draft.editorName)
      } else if (entry.anchorType === 'comment') {
        for (const trackId of allTrackIds()) {
          const part = ensure(trackId)
          part.commentCount += 1
          if (!part.editors.includes(draft.editorName)) part.editors.push(draft.editorName)
        }
      }
    }
  }
  return result
})
