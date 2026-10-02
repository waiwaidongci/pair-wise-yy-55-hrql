import type { JournalEntry, PersistedMergeState, RecoveryReport } from '../types'

/**
 * 离线持久层：
 * - yy55-merge/manifest.json 记录当前指针，并随指针保存每份检查点的操作流水摘要
 * - yy55-merge/checkpoint-<0|1|2>.json 三代完整检查点，写入新槽再切换指针（原子切换，不会只剩半截）
 * - v1：旧版 yy55-score-draft 单键草稿，升级时保留全部音符与评论
 */
const PREFIX = 'yy55-merge'
const KEY_MANIFEST = `${PREFIX}/manifest`
const SLOT_COUNT = 3
export const LEGACY_KEY = 'yy55-score-draft'

interface Manifest { active: number; slots: ({ savedAt: number; journal: JournalEntry[] } | null)[] }
interface CheckpointEnvelope { ok: true; savedAt: number; state: PersistedMergeState }

function readJSON<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function getManifest(): Manifest {
  const manifest = readJSON<Manifest>(localStorage.getItem(KEY_MANIFEST))
  if (manifest && Array.isArray(manifest.slots) && manifest.slots.length === SLOT_COUNT) return manifest
  return { active: 0, slots: [null, null, null] }
}

function allJournals(state: PersistedMergeState): JournalEntry[] {
  return state.drafts.flatMap((draft) => draft.journal.map((entry) => ({ ...entry, editorId: draft.editorId })))
}

/** 原子轮转写入：先写到下一个槽，成功后再更新指针 */
export function saveState(state: PersistedMergeState): void {
  const manifest = getManifest()
  const nextSlot = (manifest.active + 1) % SLOT_COUNT
  const savedAt = Date.now()
  const envelope: CheckpointEnvelope = { ok: true, savedAt, state: { ...state, savedAt } }
  localStorage.setItem(`${PREFIX}/checkpoint-${nextSlot}`, JSON.stringify(envelope))
  const nextManifest: Manifest = { active: nextSlot, slots: [...manifest.slots] }
  nextManifest.slots[nextSlot] = { savedAt, journal: allJournals(state).slice(-60) }
  localStorage.setItem(KEY_MANIFEST, JSON.stringify(nextManifest))
}

function slotEnvelope(slot: number): { savedAt: number; state: PersistedMergeState } | null {
  const envelope = readJSON<CheckpointEnvelope>(localStorage.getItem(`${PREFIX}/checkpoint-${slot}`))
  if (!envelope || envelope.ok !== true || !envelope.state || !Array.isArray(envelope.state.drafts) || !Array.isArray(envelope.state.canonicalTracks)) return null
  return { savedAt: envelope.savedAt, state: envelope.state }
}

export function readLegacyV1(): { tracks: unknown; comments: unknown } | null {
  return readJSON<{ tracks: unknown; comments: unknown }>(localStorage.getItem(LEGACY_KEY))
}

export interface LoadResult {
  state: PersistedMergeState | null
  report: RecoveryReport | null
}

/** 按「活动槽 → 其余槽（按时间新→旧）」顺序找最近完整检查点；都坏则返回 null 并说明丢失范围 */
export function loadState(fallback: PersistedMergeState | null): LoadResult {
  const manifest = getManifest()
  const others = manifest.slots
    .map((slot, index) => ({ slot, index }))
    .filter((item) => item.index !== manifest.active && item.slot)
    .sort((a, b) => (b.slot!.savedAt) - (a.slot!.savedAt))
    .map((item) => item.index)
  const order = [manifest.active, ...others]

  for (const slot of order) {
    const envelope = slotEnvelope(slot)
    if (envelope) {
      if (slot === manifest.active && !manifest.slots[manifest.active]) return { state: envelope.state, report: null }
      if (slot === manifest.active) return { state: envelope.state, report: null }
      return { state: envelope.state, report: buildRollbackReport(slot, manifest) }
    }
  }

  if (fallback) return { state: fallback, report: buildTotalLossReport(manifest) }
  return { state: null, report: null }
}

/** 比对损坏槽与恢复槽的流水摘要，列出丢失操作范围 */
function buildRollbackReport(restoredSlot: number, manifest: Manifest): RecoveryReport {
  const broken = manifest.slots[manifest.active]
  const restored = manifest.slots[restoredSlot]
  const restoredSeqs = new Set((restored?.journal ?? []).map((entry) => `${entry.editorId}:${entry.seq}`))
  const lostOperations = (broken?.journal ?? []).filter((entry) => !restoredSeqs.has(`${entry.editorId}:${entry.seq}`))
  return {
    restoredAt: Date.now(),
    reason: 'corrupt-checkpoint',
    usedSavedAt: restored?.savedAt,
    brokenSavedAt: broken?.savedAt,
    lostOperations,
    message: `最新自动保存（${formatStamp(broken?.savedAt)}）读取失败，已回滚到最近完整草稿（${formatStamp(restored?.savedAt)}）。`,
  }
}

function buildTotalLossReport(manifest: Manifest): RecoveryReport {
  const lostOperations = manifest.slots[manifest.active]?.journal ?? []
  return {
    restoredAt: Date.now(),
    reason: 'corrupt-checkpoint',
    brokenSavedAt: manifest.slots[manifest.active]?.savedAt,
    lostOperations,
    message: '全部离线检查点均无法读取，已使用内置排练稿恢复，本地未合并改动丢失。',
  }
}

export function formatStamp(stamp: number | null | undefined): string {
  if (!stamp) return '未知时间'
  return new Date(stamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** 模拟最新检查点损坏（演示恢复路径）：破坏活动槽内容 */
export function corruptLatestCheckpoint(): number | null {
  const manifest = getManifest()
  const brokenAt = manifest.slots[manifest.active]?.savedAt ?? null
  localStorage.setItem(`${PREFIX}/checkpoint-${manifest.active}`, '{ "ok": true, "savedAt":')
  return brokenAt
}

/** 模拟三份检查点全部损坏 */
export function corruptAllCheckpoints(): void {
  Array.from({ length: SLOT_COUNT }, (_, index) => index).forEach((slot) => {
    localStorage.setItem(`${PREFIX}/checkpoint-${slot}`, '<<corrupt>>')
  })
  localStorage.setItem(KEY_MANIFEST, '{broken')
}

/** 升级后删除 v1 草稿键（内容已完整迁入待合并草稿） */
export function consumeLegacyV1(): void {
  localStorage.removeItem(LEGACY_KEY)
}

export function describeJournalEntries(entries: JournalEntry[]): string {
  if (!entries.length) return '无操作流水记录，无法逐笔列出丢失范围。'
  return entries.map((entry) => `· ${formatStamp(entry.time)} ${entry.label}（${entry.anchorText}）`).join('\n')
}
