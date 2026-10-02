// 端到端逻辑验证（node 运行；用 esbuild 即时转译 TS）
import assert from 'node:assert'
import { buildMergeQueue, diffDraft } from '../src/merge/engine.ts'
import * as storage from '../src/merge/storage.ts'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
}

let pass = 0
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓', name); pass++ }

// ---------- 1. 初始种子：三方草稿与冲突 ----------
const { store, simulateAndReload } = await import('../src/store.ts')
let s = store.getState().score
ok('初始离线', s.online === false)
let queue = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, {})
const dynItem = queue.find((i) => i.noteId === 'N-5' && i.field === 'dynamic')
ok('圆号 N-5 力度被识别为冲突（指挥 p vs 作曲 mp）', dynItem?.status === 'conflict')
ok('冲突项有两个来源且新值不同', dynItem.changes.length === 2 && new Set(dynItem.changes.map((c) => JSON.stringify(c.newValue))).size === 2)
ok('冲突项未决定前 decided=false', dynItem.decided === false)
const tieItem = queue.find((i) => i.noteId === 'N-8' && i.field === 'tie')
ok('作曲单方延音线改动为 clean', tieItem?.status === 'clean' && !tieItem.decided)
const cm1Item = queue.find((i) => i.commentId === 'CM-1')
ok('指挥处理 CM-1 评论为待合并项', cm1Item && cm1Item.changes.some((c) => c.newValue === true))

// 分谱影响
const beforeN5 = s.canonicalTracks.find((t) => t.id === 'TR-03').notes[4].dynamic
ok('合并前总谱 N-5 保持原值 ' + beforeN5, beforeN5 === 'mf')

// ---------- 2. 离线时也能预判，但只有出版在线才能提交 ----------
const { setDecision, applyMerges, setActiveEditor, setOnline, updateNote } = await import('../src/store.ts')
// 出版逐项决定：力度选指挥（p），延音线接受作曲，评论接受指挥
store.dispatch(setDecision({ changeId: dynItem.changes.find((c) => c.editorId === 'conductor').id, decision: 'accepted' }))
store.dispatch(setDecision({ changeId: dynItem.changes.find((c) => c.editorId === 'composer').id, decision: 'rejected' }))
store.dispatch(setDecision({ changeId: tieItem.changes[0].id, decision: 'accepted' }))
store.dispatch(setDecision({ changeId: cm1Item.changes[0].id, decision: 'accepted' }))
s = store.getState().score
queue = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, s.decisions)
ok('三项均已决定', queue.filter((i) => i.decided).length === 3)

// 离线状态提交被守卫拦截
store.dispatch(setActiveEditor('publisher'))
store.dispatch(applyMerges())
s = store.getState().score
ok('离线时出版编辑也不能合并（守卫拦截，决定保留）', s.mergeLog.length === 0 && Object.keys(s.decisions).length > 0)
store.dispatch(setOnline(true))
store.dispatch(applyMerges()) // 网络恢复后提交
s = store.getState().score
const tr3 = s.canonicalTracks.find((t) => t.id === 'TR-03')
ok('合并后总谱 N-5 = p（接受指挥）', tr3.notes[4].dynamic === 'p')
ok('合并后总谱 N-8 延音线 = true（接受作曲）', tr3.notes[7].tie === true)
ok('CM-1 评论进入总谱并已处理', s.comments.find((c) => c.id === 'CM-1').resolved === true)
ok('合并记录生成 1 条', s.mergeLog.length === 1)

// ---------- 3. 基线立即失效，锚点重算 ----------
ok('旧基线 v12 立即失效', s.baseline.status === 'invalid' && s.baseline.invalidatedAt > 0)
const staleLabels = s.baseline.staleAnchors.map((a) => `${a.anchor.kind}:${a.anchor.noteId ?? a.anchor.commentId ?? a.anchor.trackId}`)
ok('失效锚点含 N-5 / N-8 / CM-1', staleLabels.includes('note:N-5') && staleLabels.includes('note:N-8') && staleLabels.includes('comment:CM-1'))

// 受影响小节（第 2 小节）随 v12 已解决的评论 CM-4，结论应立即失效待复核
const cm4 = s.comments.find((c) => c.id === 'CM-4')
ok('同小节已解决评论 CM-4 结论立即失效待复核', cm4.needsRecheck === true)
const cm3 = s.comments.find((c) => c.id === 'CM-3')
ok('不受影响小节的 CM-3 结论不失效', !cm3.needsRecheck)
const { confirmCommentRecheck, lockBaseline } = await import('../src/store.ts')
store.dispatch(confirmCommentRecheck('CM-4'))
s = store.getState().score
ok('出版复核后 CM-4 恢复', !s.comments.find((c) => c.id === 'CM-4').needsRecheck)

// 重锁基线
store.dispatch(lockBaseline())
s = store.getState().score
ok('重锁后基线有效且版本推进', s.baseline.status === 'valid' && s.baseline.id !== 'v12')
ok('重锁后草稿基线同步、无残余队列', buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, {}).length === 0)

// ---------- 4. rebase 冲突不静默覆盖 ----------
// 指挥与作曲再对同一音符给不同值；先合并指挥，再看作曲草稿被 rebase 成显式冲突
store.dispatch(setOnline(false))
store.dispatch(setActiveEditor('conductor'))
store.dispatch({ type: 'score/selectTrack', payload: 'TR-01' })
store.dispatch({ type: 'score/selectNote', payload: 0 })
store.dispatch(updateNote({ dynamic: 'f' }))
store.dispatch(setActiveEditor('composer'))
store.dispatch({ type: 'score/selectTrack', payload: 'TR-01' })
store.dispatch({ type: 'score/selectNote', payload: 0 })
store.dispatch(updateNote({ dynamic: 'pp' }))
s = store.getState().score
let q3 = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, {})
const n1 = q3.find((i) => i.noteId === 'N-1' && i.field === 'dynamic')
ok('第二轮 N-1 力度再次冲突（f vs pp）', n1.status === 'conflict')
// 出版只合并指挥的 f
store.dispatch(setOnline(true)); store.dispatch(setActiveEditor('publisher'))
const condChoice = n1.changes.find((c) => c.editorId === 'conductor')
const compChoice = n1.changes.find((c) => c.editorId === 'composer')
store.dispatch(setDecision({ changeId: condChoice.id, decision: 'accepted' }))
store.dispatch(setDecision({ changeId: compChoice.id, decision: 'rejected' }))
s = store.getState().score
const n1Decided = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, s.decisions).find((i) => i.noteId === 'N-1' && i.field === 'dynamic')
ok('冲突项双方都已决定', n1Decided.decided === true)
store.dispatch(applyMerges())
s = store.getState().score
ok('总谱 N-1 = f', s.canonicalTracks[0].notes[0].dynamic === 'f')
const compDraft = s.drafts.find((d) => d.editorId === 'composer')
// 作曲草稿：N-1 被拒绝复位为 f；rebaseConflicts 为空（该项已被显式决定）
const compQueue = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, {})
ok('被显式拒绝的作曲改动不再残留为冲突', !compQueue.some((i) => i.noteId === 'N-1'))
ok('作曲草稿工作区已复位为总谱值 f（拒绝生效，未静默保留 pp）', compDraft.tracks[0].notes[0].dynamic === 'f')

// 未参与本轮的草稿（出版空草稿）应自动跟随，不产生噪音改动
const pubDraft = s.drafts.find((d) => d.editorId === 'publisher')
ok('其他草稿 rebase 后无分歧噪音', diffDraft(pubDraft, s.canonicalTracks).length === 0)

// ---------- 4b. 第三方独立改动在他人合并后升级为显式冲突，不静默覆盖 ----------
// 重做一次干净的三方：指挥、作曲都改 N-2；出版先合并指挥
store.dispatch(setOnline(false))
store.dispatch(setActiveEditor('conductor'))
store.dispatch({ type: 'score/selectTrack', payload: 'TR-01' })
store.dispatch({ type: 'score/selectNote', payload: 1 })
store.dispatch(updateNote({ dynamic: 'ff' }))
store.dispatch(setActiveEditor('publisher')) // 出版先不合，模拟指挥方先准备好
store.dispatch(setActiveEditor('composer'))
store.dispatch({ type: 'score/selectTrack', payload: 'TR-01' })
store.dispatch({ type: 'score/selectNote', payload: 1 })
store.dispatch(updateNote({ dynamic: 'pp' }))
s = store.getState().score
let q4 = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, {})
const n2 = q4.find((i) => i.noteId === 'N-2' && i.field === 'dynamic')
ok('4b：N-2 力度三方冲突（ff vs pp）', n2.status === 'conflict')
// 出版只决定指挥 ff；作曲那条保持未决 → 整个冲突项不满足"全部决定"，无法落总谱
store.dispatch(setOnline(true)); store.dispatch(setActiveEditor('publisher'))
const n2cond = n2.changes.find((c) => c.editorId === 'conductor')
const n2comp = n2.changes.find((c) => c.editorId === 'composer')
store.dispatch(setDecision({ changeId: n2cond.id, decision: 'accepted' }))
s = store.getState().score
const n2partial = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, s.decisions).find((i) => i.noteId === 'N-2')
ok('4b：只决定一方时冲突项仍未决（禁止带着未决来源提交）', n2partial.decided === false)
// 补拒合作曲后提交
store.dispatch(setDecision({ changeId: n2comp.id, decision: 'rejected' }))
store.dispatch(applyMerges())
s = store.getState().score
ok('4b：总谱 N-2 = ff', s.canonicalTracks[0].notes[1].dynamic === 'ff')

// 出版重锁基线，回到干净态再做 rebase 冲突测试
store.dispatch(lockBaseline())
s = store.getState().score
// 出版自己改 N-3 准备合并；作曲离线独立改了同一音符（未参与决定）→ rebase 后显式冲突
store.dispatch(setOnline(false))
store.dispatch(setActiveEditor('composer'))
store.dispatch({ type: 'score/selectTrack', payload: 'TR-01' })
store.dispatch({ type: 'score/selectNote', payload: 2 })
store.dispatch(updateNote({ dynamic: 'p' }))
store.dispatch(setActiveEditor('publisher'))
store.dispatch({ type: 'score/selectTrack', payload: 'TR-01' })
store.dispatch({ type: 'score/selectNote', payload: 2 })
store.dispatch(updateNote({ dynamic: 'ff' }))
s = store.getState().score
// 出版联网，只决定出版自己的改动（单方 clean 项）并合并；作曲完全不经手
store.dispatch(setOnline(true))
const q5pub = buildMergeQueue(s.drafts, s.canonicalTracks, s.comments, {}).filter((i) => i.noteId === 'N-3' && i.changes.some((c) => c.editorId === 'publisher'))
q5pub.forEach((i) => i.changes.filter((c) => c.editorId === 'publisher').forEach((c) => store.dispatch(setDecision({ changeId: c.id, decision: 'accepted' }))))
// 注意：此时 N-3 是出版 ff 与作曲 p 的两方冲突，必须同时决定作曲方才能提交 → 改由纯函数验证 rebase
s = store.getState().score
const base = structuredClone(s.canonicalTracks)
const baseComments = structuredClone(s.comments)
const decidedQ = buildMergeQueue(s.drafts, base, baseComments, { [q5pub[0]!.changes.find((c) => c.editorId === 'publisher')!.id]: 'accepted' })
const n3conflictItem = decidedQ.find((i) => i.noteId === 'N-3' && i.field === 'dynamic')!
ok('4c：出版与作曲对 N-3 构成冲突', n3conflictItem.status === 'conflict')
// 模拟"出版先合自己的"极端路径：仅接受出版来源（其余来源视为尚未到场），验证 rebase 不吞掉作曲值
const { applyItems, rebaseDraft, anchorKey } = await import('../src/merge/engine.ts')
const forcedItems = [{ ...n3conflictItem, changes: n3conflictItem.changes.map((c) => ({ ...c, decision: c.editorId === 'publisher' ? 'accepted' as const : 'rejected' as const })), decided: true, accepted: true }]
const applied = applyItems(base, baseComments, forcedItems)
const composerDraft = s.drafts.find((d) => d.editorId === 'composer')
const accKeys = new Set(applied.acceptedItems.map((i) => anchorKey(i.anchor, i.field)))
const rebased = rebaseDraft(composerDraft, base, baseComments, applied.tracks, applied.comments, accKeys, new Set(), () => '长笛')
ok('4c：未参与合并的作曲草稿保留自己的 p（不被 ff 静默覆盖）', rebased.tracks[0]!.notes[2]!.dynamic === 'p')
ok('4c：rebase 生成一对 merged/草稿 伪冲突', rebased.rebaseConflicts.length === 2 && rebased.rebaseConflicts.some((c) => c.source === 'merged' && c.newValue === 'ff') && rebased.rebaseConflicts.some((c) => c.source === 'draft' && c.newValue === 'p'))
const q6 = buildMergeQueue([rebased], applied.tracks, applied.comments, {})
ok('4c：伪冲突在下一轮合并队列中显式标为 conflict', q6.find((i) => i.noteId === 'N-3' && i.field === 'dynamic')?.status === 'conflict')

// ---------- 5. 离线检查点：最新损坏 → 回滚最近完整草稿并列出丢失范围 ----------
mem.clear()
// 重新构造 store 环境：直接用 storage API 模拟三代
const { buildSeedDrafts, withSeedJournals } = await import('../src/mock.ts')
let draftsState = withSeedJournals(buildSeedDrafts())
const makeState = (drafts) => ({
  version: 2, savedAt: Date.now(), journalSeq: 3,
  canonicalTracks: drafts[0].baseTracks, comments: drafts[0].baseComments,
  drafts, baseline: null, decisions: {}, mergeLog: [], versions: [],
  activeEditor: 'conductor', online: false, dirty: true,
})
storage.saveState(makeState(structuredClone(draftsState)))
storage.saveState(makeState(structuredClone(draftsState))) // 第二个槽
// 第三槽：多一笔操作（模拟晚于恢复点的丢失操作）
const newer = structuredClone(draftsState)
newer[0].journal.push({ seq: 99, time: Date.now(), editorId: 'conductor', label: '断网前最后一笔：长笛力度改动', anchorText: '长笛 第 1 小节' })
storage.saveState(makeState(newer))
const brokenAt = storage.corruptLatestCheckpoint()
ok('损坏点时间存在', typeof brokenAt === 'number')
const loaded = storage.loadState(null)
ok('回滚到更早的完整检查点', loaded.state !== null && loaded.report?.reason === 'corrupt-checkpoint')
ok('丢失范围列出 1 笔操作', loaded.report.lostOperations.length === 1 && loaded.report.lostOperations[0].label.includes('最后一笔'))
ok('说明文本含回滚与损坏时间', loaded.report.message.includes('读取失败'))

// 全部损坏
storage.corruptAllCheckpoints()
const none = storage.loadState(null)
ok('三槽尽毁时返回 null（由调用方退回内置稿）', none.state === null && none.report === null)

// ---------- 6. v1 旧稿升级：保留原音符与评论 ----------
mem.clear()
const v1Tracks = structuredClone(draftsState[0].baseTracks)
v1Tracks[0].notes[0].expression = '旧稿表情'
mem.set(storage.LEGACY_KEY, JSON.stringify({ tracks: v1Tracks, comments: draftsState[0].baseComments }))
// 重新导入 store 以触发 rehydrate（模块缓存会妨碍，改用直接调用 reducer 的纯函数路径验证）
const { importLegacyDraft } = await import('../src/store.ts')
// 用一个全新 slice 状态：借助现有 store 不易清空，改为校验 storage 读取
const legacy = storage.readLegacyV1()
ok('v1 旧稿可读且原音符保留', Array.isArray(legacy.tracks) && legacy.tracks[0].notes.length === 12)
// dispatch importLegacyDraft 到当前 store 验证迁移动作
const before = store.getState().score
store.dispatch(importLegacyDraft({ tracks: legacy.tracks, comments: legacy.comments }))
const after = store.getState().score
const legacyDraft = after.drafts.find((d) => d.id.startsWith('draft-legacy-'))
ok('旧稿成为独立待合并草稿（不覆盖总谱）', !!legacyDraft && after.canonicalTracks === before.canonicalTracks)
ok('旧稿差异以锚点进入合并队列', buildMergeQueue(after.drafts, after.canonicalTracks, after.comments, {}).some((i) => i.noteId === 'N-1' && i.field === 'expression'))
ok('升级报告记录保留数量', after.recoveryReport.legacy.preservedNotes === 48 && after.recoveryReport.legacy.preservedComments === 4)
ok('v1 键已消费删除', !mem.has(storage.LEGACY_KEY))

// 旧稿 JSON 损坏：readLegacyV1 返回 null，不炸启动
mem.set(storage.LEGACY_KEY, '{broken json')
ok('损坏 v1 草稿读取为 null', storage.readLegacyV1() === null)

console.log(`\n全部通过：${pass} 项断言`)
