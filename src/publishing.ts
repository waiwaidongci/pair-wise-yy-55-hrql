import type { BaselineSnapshot, DraftAnchorType, DraftChangeLogEntry, EditorDraft, EditorProfile, RecoveryNotice, ScoreComment, ScoreNote, Track } from './types'
import { seedComments, seedTracks } from './mock'

export const EDITORS: EditorProfile[] = [
  { id: 'ED-01', name: '沈青', role: '作曲' },
  { id: 'ED-02', name: '方亦', role: '指挥' },
  { id: 'ED-03', name: '赵晴', role: '出版编辑' },
]

export const KEY_WORKING = 'yy55-score-draft'
export const KEY_BASELINE = 'yy55-baseline'
const KEY_MIGRATED = 'yy55-migrated'
export const draftKey = (id: string) => `yy55-draft-${id}`
export const completeKey = (id: string) => `yy55-complete-${id}`
export const logKey = (id: string) => `yy55-draftlog-${id}`

export const NOTE_FIELDS = ['key', 'duration', 'accidental', 'dynamic', 'tie', 'expression'] as const
export const COMMENT_FIELDS = ['content', 'resolved'] as const

export const FIELD_LABELS: Record<string, string> = {
  key: '音高', duration: '时值', accidental: '临时记号', dynamic: '力度', tie: '延音线', expression: '表情标记',
  transposition: '移调', content: '评论内容', resolved: '解决状态',
  __inserted: '新增音符', __deleted: '删除音符',
}

export function changeKey(e: Pick<DraftChangeLogEntry, 'anchorType' | 'anchorId' | 'field' | 'trackId'>): string {
  return `${e.anchorType}:${e.trackId ?? ''}:${e.anchorId}:${e.field}`
}

const nowIso = () => new Date().toISOString()

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// ---------- 差异比较：按音符 / 评论锚点记录来源与时间 ----------

export function diffTracks(prev: Track[], next: Track[]): DraftChangeLogEntry[] {
  const entries: DraftChangeLogEntry[] = []
  const prevMap = new Map(prev.map((t) => [t.id, t]))
  for (const nt of next) {
    const pt = prevMap.get(nt.id)
    if (pt && pt.transposition !== nt.transposition) {
      entries.push({ anchorType: 'track', anchorId: nt.id, field: 'transposition', from: pt.transposition, to: nt.transposition, time: nowIso() })
    }
    const pn = new Map(pt ? pt.notes.map((n) => [n.id, n] as const) : [])
    const nn = new Map(nt.notes.map((n) => [n.id, n] as const))
    for (const [id, note] of nn) {
      const old = pn.get(id)
      if (!old) {
        entries.push({ anchorType: 'note', anchorId: id, trackId: nt.id, field: '__inserted', from: false, to: clone(note), time: nowIso() })
        continue
      }
      for (const field of NOTE_FIELDS) {
        if (!Object.is(old[field], note[field])) {
          entries.push({ anchorType: 'note', anchorId: id, trackId: nt.id, field, from: old[field], to: note[field], time: nowIso() })
        }
      }
    }
    for (const [id] of pn) {
      if (!nn.has(id)) entries.push({ anchorType: 'note', anchorId: id, trackId: nt.id, field: '__deleted', from: false, to: true, time: nowIso() })
    }
  }
  return entries
}

export function diffComments(prev: ScoreComment[], next: ScoreComment[]): DraftChangeLogEntry[] {
  const entries: DraftChangeLogEntry[] = []
  const prevMap = new Map(prev.map((c) => [c.id, c]))
  for (const nc of next) {
    const oc = prevMap.get(nc.id)
    if (!oc) continue
    for (const field of COMMENT_FIELDS) {
      if (!Object.is(oc[field], nc[field])) {
        entries.push({ anchorType: 'comment', anchorId: nc.id, field, from: oc[field], to: nc[field], time: nowIso() })
      }
    }
  }
  return entries
}

// ---------- 校验：读取失败时识别损坏 / 不完整数据 ----------

export function validateScoreData(data: unknown): data is { tracks: Track[]; comments: ScoreComment[] } {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.tracks) || !Array.isArray(d.comments) || d.tracks.length === 0) return false
  return d.tracks.every((t) => {
    const tr = t as Record<string, unknown>
    return typeof tr.id === 'string' && Array.isArray(tr.notes) && (tr.notes as unknown[]).every((n) => {
      const nt = n as Record<string, unknown>
      return typeof nt.id === 'string' && typeof nt.key === 'string' && typeof nt.dynamic === 'string'
    })
  })
}

function validateDraft(data: unknown): data is EditorDraft {
  if (!validateScoreData(data)) return false
  const d = data as Record<string, unknown>
  return typeof d.editorId === 'string' && typeof d.editorName === 'string' && typeof d.savedAt === 'string' && Array.isArray(d.changeLog)
}

function validateBaseline(data: unknown): data is BaselineSnapshot {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.id === 'string' && typeof d.label === 'string' && typeof d.lockedAt === 'string'
    && validateScoreData({ tracks: d.tracks, comments: d.comments })
}

export function tryParse(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ---------- 持久化 ----------

export function persistWorking(tracks: Track[], comments: ScoreComment[]) {
  try { localStorage.setItem(KEY_WORKING, JSON.stringify({ tracks, comments })) } catch { /* 存储配额不足时忽略 */ }
}

export function persistDraft(draft: EditorDraft): boolean {
  try {
    const json = JSON.stringify(draft)
    localStorage.setItem(draftKey(draft.editorId), json)
    const verified = tryParse(localStorage.getItem(draftKey(draft.editorId)))
    if (validateDraft(verified)) {
      localStorage.setItem(completeKey(draft.editorId), json)
      return true
    }
    return false
  } catch { return false }
}

export function persistBaseline(baseline: BaselineSnapshot) {
  try { localStorage.setItem(KEY_BASELINE, JSON.stringify(baseline)) } catch { /* ignore */ }
}

export function clearDraftStorage(editorId: string) {
  localStorage.removeItem(draftKey(editorId))
  localStorage.removeItem(completeKey(editorId))
  localStorage.removeItem(logKey(editorId))
}

// ---------- 启动加载：旧稿升级、损坏恢复、丢失范围说明 ----------

export interface InitialState {
  tracks: Track[]
  comments: ScoreComment[]
  drafts: EditorDraft[]
  baseline: BaselineSnapshot | null
  editors: EditorProfile[]
  currentEditorId: string
  recoveryNotices: RecoveryNotice[]
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function describeEntry(e: DraftChangeLogEntry): string {
  if (e.field === '__inserted') return `新增音符 ${e.anchorId}`
  if (e.field === '__deleted') return `删除音符 ${e.anchorId}`
  const field = FIELD_LABELS[e.field] ?? e.field
  return `${e.anchorType === 'note' ? '音符' : e.anchorType === 'comment' ? '评论' : '声部'} ${e.anchorId} · ${field}`
}

function notice(type: RecoveryNotice['type'], title: string, description: string, extra?: Partial<RecoveryNotice>): RecoveryNotice {
  return { id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, title, description, time: nowIso(), ...extra }
}

export function loadInitialState(): InitialState {
  const notices: RecoveryNotice[] = []
  const editors = EDITORS
  const currentEditorId = editors[0]!.id

  // 工作副本：主草稿 → 基线 → 种子数据
  let tracks: Track[] = structuredClone(seedTracks)
  let comments: ScoreComment[] = structuredClone(seedComments)
  const workingParsed = tryParse(localStorage.getItem(KEY_WORKING))
  const baselineParsed = tryParse(localStorage.getItem(KEY_BASELINE))
  const baseline: BaselineSnapshot | null = validateBaseline(baselineParsed) ? baselineParsed : null
  let legacyValid = false
  if (validateScoreData(workingParsed)) {
    tracks = workingParsed.tracks
    comments = workingParsed.comments
    legacyValid = true
  } else if (baseline) {
    tracks = structuredClone(baseline.tracks)
    comments = structuredClone(baseline.comments)
    notices.push(notice('recovery', '工作草稿读取失败', `最近草稿文件损坏或不完整，已恢复至出版基线（${baseline.label}）；基线之后未合并的改动不在任何完整副本中，已全部丢失。`, { lostItems: ['基线锁定后对总谱与评论的全部未合并改动'], time: baseline.lockedAt }))
  } else if (workingParsed) {
    notices.push(notice('recovery', '工作草稿读取失败', '草稿文件损坏且没有可用的出版基线，已恢复为初始总谱；本地草稿中未合并的改动已丢失。'))
  }

  if (baselineParsed && !baseline) {
    notices.push(notice('recovery', '出版基线文件损坏', '基线文件无法读取，已忽略；请在合并完成后重新锁定出版基线。'))
  }

  // 各编辑的待合并草稿：主草稿 → 最近完整草稿
  const drafts: EditorDraft[] = []
  const draftIds = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    const m = /^yy55-draft-(.+)$/.exec(key)
    if (m && !key.startsWith('yy55-draftlog-')) draftIds.add(m[1]!)
  }
  for (const editorId of draftIds) {
    const primary = tryParse(localStorage.getItem(draftKey(editorId)))
    if (validateDraft(primary)) { drafts.push(primary); continue }
    const backup = tryParse(localStorage.getItem(completeKey(editorId)))
    if (validateDraft(backup)) {
      const log = tryParse(localStorage.getItem(logKey(editorId))) as DraftChangeLogEntry[] | null
      const lost = Array.isArray(log) ? log.filter((e) => e.time > backup.savedAt) : []
      drafts.push(backup)
      notices.push(notice('recovery', `草稿读取失败 · ${backup.editorName}`, `主草稿文件损坏或不完整，已恢复至最近完整草稿（${fmtTime(backup.savedAt)}）。该时间点之后有 ${lost.length} 项改动未出现在完整副本中，无法恢复。`, { lostItems: lost.map(describeEntry) }))
    } else {
      notices.push(notice('recovery', `草稿完全丢失 · 编辑 ${editorId}`, '主草稿与完整备份均无法读取，该编辑的待合并改动已全部丢失。'))
    }
  }

  // 旧版单稿升级：保留原音符与评论，转入待合并草稿
  if (legacyValid && !localStorage.getItem(KEY_MIGRATED)) {
    const noteCount = tracks.reduce((n, t) => n + t.notes.length, 0)
    const legacyDraft: EditorDraft = {
      id: 'D-legacy', editorId: 'ED-legacy', editorName: '旧版草稿（升级保留）',
      savedAt: nowIso(), basedOnBaselineId: baseline?.id ?? null,
      tracks: structuredClone(tracks), comments: structuredClone(comments),
      changeLog: [], resolutions: {}, status: 'pending',
    }
    drafts.push(legacyDraft)
    localStorage.setItem(draftKey('ED-legacy'), JSON.stringify(legacyDraft))
    localStorage.setItem(completeKey('ED-legacy'), JSON.stringify(legacyDraft))
    localStorage.setItem(KEY_MIGRATED, '1')
    notices.push(notice('migration', '旧版草稿已升级为待合并草稿', `已完整保留原草稿中的 ${noteCount} 个音符与 ${comments.length} 条评论，可在「待合并草稿」中逐项核对后再合并。`, { preservedNotes: noteCount, preservedComments: comments.length }))
  }

  return { tracks, comments, drafts, baseline, editors, currentEditorId, recoveryNotices: notices }
}

// ---------- 合并审阅：按锚点 / 字段的三方比较 ----------

export interface ReviewCandidate {
  editorId: string
  editorName: string
  time: string
  value: unknown
  draftId: string
}

export interface ReviewItem {
  key: string
  anchorType: DraftAnchorType
  anchorId: string
  trackId?: string
  measure?: number
  field: string
  base: unknown
  ours: unknown
  candidates: ReviewCandidate[]
  status: 'clean' | 'conflict' | 'obsolete' | 'applied'
}

export function buildReview(drafts: EditorDraft[], tracks: Track[], comments: ScoreComment[]): ReviewItem[] {
  const pending = drafts.filter((d) => d.status === 'pending')
  const map = new Map<string, ReviewItem>()
  for (const draft of pending) {
    for (const entry of draft.changeLog) {
      const key = changeKey(entry)
      let item = map.get(key)
      if (!item) {
        item = { key, anchorType: entry.anchorType, anchorId: entry.anchorId, trackId: entry.trackId, field: entry.field, base: entry.from, ours: null, candidates: [], status: 'clean' }
        map.set(key, item)
      }
      item.candidates.push({ editorId: draft.editorId, editorName: draft.editorName, time: entry.time, value: entry.to, draftId: draft.id })
    }
  }

  const allDraftTracks = pending.flatMap((d) => d.tracks)
  for (const item of map.values()) {
    if (item.anchorType === 'note') {
      const locate = (trackList: Track[]) => {
        for (const t of trackList) {
          if (item.trackId && t.id !== item.trackId) continue
          const idx = t.notes.findIndex((n) => n.id === item.anchorId)
          if (idx >= 0) { item.trackId = t.id; item.measure = Math.floor(idx / 4) + 1; return true }
        }
        return false
      }
      locate(tracks) || locate(allDraftTracks)
    } else if (item.anchorType === 'comment') {
      item.measure = comments.find((c) => c.id === item.anchorId)?.measure
        ?? pending.map((d) => d.comments.find((c) => c.id === item.anchorId)?.measure).find((m) => m !== undefined)
    }

    let exists = true
    let current: unknown
    if (item.anchorType === 'note') {
      const t = item.trackId ? tracks.find((tr) => tr.id === item.trackId) : tracks.find((tr) => tr.notes.some((n) => n.id === item.anchorId))
      const n = t?.notes.find((nt) => nt.id === item.anchorId)
      if (!n) exists = false
      else current = item.field === '__deleted' ? true : item.field === '__inserted' ? true : (n as unknown as Record<string, unknown>)[item.field]
      if (item.field === '__inserted') current = exists
      if (item.field === '__deleted') current = !exists
    } else if (item.anchorType === 'comment') {
      const c = comments.find((cm) => cm.id === item.anchorId)
      if (!c) exists = false
      else current = (c as unknown as Record<string, unknown>)[item.field]
    } else {
      const t = tracks.find((tr) => tr.id === item.anchorId)
      if (!t) exists = false
      else current = (t as unknown as Record<string, unknown>)[item.field]
    }
    item.ours = current

    const values = item.candidates.map((c) => c.value)
    const existenceField = item.field === '__inserted' || item.field === '__deleted'
    const allSame = existenceField ? true : values.every((v) => Object.is(v, values[0]))
    if (!exists) item.status = 'obsolete'
    else if (existenceField) {
      const alreadyApplied = item.field === '__inserted' ? exists : !exists
      item.status = alreadyApplied ? 'applied' : 'clean'
    }
    else if (allSame && Object.is(current, values[0])) item.status = 'applied'
    else if (allSame && Object.is(current, item.base)) item.status = 'clean'
    else item.status = 'conflict'
  }

  // 删除与修改同锚点 → 冲突，不能静默采用删除
  for (const item of map.values()) {
    if (item.field !== '__deleted' || item.status === 'obsolete' || item.status === 'applied') continue
    const otherFields = new Set<string>()
    for (const draft of pending) {
      if (!draft.changeLog.some((e) => e.anchorType === 'note' && e.anchorId === item.anchorId)) continue
      for (const e of draft.changeLog) {
        if (e.anchorType === 'note' && e.anchorId === item.anchorId && e.field !== '__deleted') otherFields.add(e.field)
      }
    }
    if (otherFields.size > 0) item.status = 'conflict'
  }

  const order = { conflict: 0, obsolete: 1, clean: 2, applied: 3 }
  return Array.from(map.values()).sort((a, b) =>
    order[a.status] - order[b.status] || (a.measure ?? 99) - (b.measure ?? 99) || a.anchorId.localeCompare(b.anchorId))
}

// ---------- 应用合并结果到工作副本 ----------

export function applyValueToWorking(tracks: Track[], comments: ScoreComment[], drafts: EditorDraft[], item: ReviewItem, value: unknown) {
  if (item.anchorType === 'note') {
    if (item.field === '__inserted') {
      const note = value as ScoreNote
      if (tracks.some((t) => t.notes.some((n) => n.id === note.id))) return
      const track = tracks.find((t) => t.id === item.trackId) ?? tracks[0]!
      let index = track.notes.length
      for (const d of drafts) {
        const t = d.tracks.find((tr) => tr.id === track.id)
        const idx = t?.notes.findIndex((n) => n.id === note.id)
        if (t && idx && idx >= 0) { index = idx; break }
      }
      track.notes.splice(Math.min(index, track.notes.length), 0, clone(note))
      return
    }
    if (item.field === '__deleted') {
      const track = tracks.find((t) => t.id === item.trackId)
      if (!track) return
      const idx = track.notes.findIndex((n) => n.id === item.anchorId)
      if (idx >= 0) track.notes.splice(idx, 1)
      return
    }
    const track = tracks.find((t) => t.id === item.trackId) ?? tracks.find((t) => t.notes.some((n) => n.id === item.anchorId))
    const note = track?.notes.find((n) => n.id === item.anchorId)
    if (note) (note as unknown as Record<string, unknown>)[item.field] = value
  } else if (item.anchorType === 'comment') {
    const c = comments.find((cm) => cm.id === item.anchorId)
    if (c) (c as unknown as Record<string, unknown>)[item.field] = value
  } else {
    const t = tracks.find((tr) => tr.id === item.anchorId)
    if (t) (t as unknown as Record<string, unknown>)[item.field] = value
  }
}

export function formatFieldValue(field: string, value: unknown): string {
  if (field === '__inserted') return '新增音符'
  if (field === '__deleted') return '删除音符'
  if (value === undefined || value === null || value === '') return '（空）'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

export function anchorLabel(item: { anchorType: DraftAnchorType; anchorId: string; measure?: number }): string {
  const measure = item.measure ? ` · 第 ${item.measure} 小节` : ''
  if (item.anchorType === 'note') return `音符 ${item.anchorId}${measure}`
  if (item.anchorType === 'comment') return `评论 ${item.anchorId}${measure}`
  return `声部 ${item.anchorId}`
}
