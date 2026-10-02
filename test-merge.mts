import assert from 'node:assert'
import { diffTracks, diffComments, buildReview, applyValueToWorking, validateScoreData, loadInitialState, draftKey, completeKey, logKey, KEY_WORKING, KEY_BASELINE, type ReviewItem } from './src/publishing'
import type { EditorDraft, ScoreComment, Track } from './src/types'

// ---------- diff ----------
const track: Track = { id: 'T1', name: '长笛', instrument: 'Flute', clef: 'treble', transposition: 0, color: '#000', notes: [
  { id: 'N1', key: 'c/5', duration: 'q', dynamic: 'mp', tie: false, expression: '' },
  { id: 'N2', key: 'd/5', duration: 'q', dynamic: 'mf', tie: false, expression: '' },
]}
const track2: Track = { ...track, notes: [
  { id: 'N1', key: 'c/5', duration: 'q', dynamic: 'f', tie: false, expression: '' },
  { id: 'N2', key: 'd/5', duration: 'q', dynamic: 'mf', tie: true, expression: 'dolce' },
  { id: 'N3', key: 'e/5', duration: 'q', dynamic: 'mf', tie: false, expression: '' },
]}
const d = diffTracks([track], [track2])
assert.equal(d.length, 4, `expected 4 changes, got ${d.length}`)
assert.deepEqual(d.map((e) => `${e.anchorId}:${e.field}`).sort(), ['N1:dynamic', 'N2:expression', 'N2:tie', 'N3:__inserted'])
assert.equal(d.find((e) => e.anchorId === 'N1')!.from, 'mp')
assert.equal(d.find((e) => e.anchorId === 'N1')!.to, 'f')

const track3: Track = { ...track, notes: [track.notes[0]!] }
const d2 = diffTracks([track], [track3])
assert.equal(d2.length, 1)
assert.equal(d2[0]!.field, '__deleted')

const comments1: ScoreComment[] = [{ id: 'C1', measure: 2, author: 'a', content: 'x', resolved: false }]
const comments2: ScoreComment[] = [{ id: 'C1', measure: 2, author: 'a', content: 'x', resolved: true }]
const dc = diffComments(comments1, comments2)
assert.equal(dc.length, 1)
assert.equal(dc[0]!.field, 'resolved')

// ---------- buildReview ----------
const mkDraft = (editorId: string, editorName: string, entries: any[], tracksOverride?: Track[]): EditorDraft => ({
  id: `D-${editorId}`, editorId, editorName, savedAt: new Date().toISOString(), basedOnBaselineId: null,
  tracks: tracksOverride ?? [track], comments: comments1, changeLog: entries, resolutions: {}, status: 'pending',
})
const entry = (anchorId: string, field: string, from: unknown, to: unknown, anchorType: 'note' | 'comment' = 'note') => ({
  anchorType, anchorId, field, from, to, time: new Date().toISOString(),
})

// clean: one editor changed, working copy untouched
const r1 = buildReview([mkDraft('E1',  '方亦', [entry('N1', 'dynamic', 'mp', 'f')])], [track], comments1)
assert.equal(r1.length, 1)
assert.equal(r1[0]!.status, 'clean')
assert.equal(r1[0]!.base, 'mp')
assert.equal(r1[0]!.ours, 'mp')

// applied: working copy already has the value
const r2 = buildReview([mkDraft('E1', '方亦', [entry('N1', 'dynamic', 'mp', 'f')])], [track2], comments1)
assert.equal(r2[0]!.status, 'applied')

// conflict: two editors, different values
const r3 = buildReview([
  mkDraft('E1', '方亦', [entry('N1', 'dynamic', 'mp', 'f')]),
  mkDraft('E2', '沈青', [entry('N1', 'dynamic', 'mp', 'p')]),
], [track], comments1)
assert.equal(r3[0]!.status, 'conflict')
assert.equal(r3[0]!.candidates.length, 2)

// conflict: delete vs modify
const r4 = buildReview([
  mkDraft('E1', '方亦', [entry('N2', '__deleted', false, true)]),
  mkDraft('E2', '沈青', [entry('N2', 'dynamic', 'mf', 'f')]),
], [track], comments1)
const del = r4.find((i) => i.field === '__deleted')!
assert.equal(del.status, 'conflict', 'delete-vs-modify must conflict')

// obsolete: note gone from working copy
const r5 = buildReview([mkDraft('E1', '方亦', [entry('N9', 'dynamic', 'mp', 'f')])], [track], comments1)
assert.equal(r5[0]!.status, 'obsolete')

// comment anchor
const r6 = buildReview([mkDraft('E1', '方亦', [entry('C1', 'resolved', false, true, 'comment')])], [track], comments1)
assert.equal(r6[0]!.status, 'clean')
assert.equal(r6[0]!.anchorType, 'comment')

// ---------- applyValueToWorking ----------
const wt: Track = structuredClone(track)
applyValueToWorking([wt], comments1, [], r1[0]!, 'f')
assert.equal(wt.notes[0]!.dynamic, 'f')

const wt2: Track = structuredClone(track)
applyValueToWorking([wt2], comments1, [], r4.find((i) => i.field === '__deleted')!, true)
assert.equal(wt2.notes.length, 1, 'delete removes note')

const wt3: Track = structuredClone(track)
const insertItem: ReviewItem = { key: 'note:N3:__inserted', anchorType: 'note', anchorId: 'N3', trackId: 'T1', field: '__inserted', base: false, ours: false, candidates: [], status: 'clean' }
applyValueToWorking([wt3], comments1, [mkDraft('E1', '方亦', [], [track2])], insertItem, track2.notes[2])
assert.equal(wt3.notes.length, 3, 'insert adds note')
assert.equal(wt3.notes[2]!.id, 'N3')

// ---------- validateScoreData ----------
assert.equal(validateScoreData({ tracks: [track], comments: comments1 }), true)
assert.equal(validateScoreData({ tracks: [], comments: [] }), false)
assert.equal(validateScoreData({ tracks: [{ id: 'x', notes: [{ id: 'a' }] }], comments: [] }), false)
assert.equal(validateScoreData(null), false)
assert.equal(validateScoreData('garbage'), false)

// ---------- loadInitialState: migration ----------
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
} as Storage

// legacy draft present, no per-editor drafts
store.set(KEY_WORKING, JSON.stringify({ tracks: [track], comments: comments1 }))
const loaded1 = loadInitialState()
assert.equal(loaded1.tracks.length, 1)
assert.equal(loaded1.drafts.length, 1, 'legacy draft migrated')
assert.equal(loaded1.drafts[0]!.editorId, 'ED-legacy')
assert.equal(loaded1.drafts[0]!.tracks[0]!.notes.length, 2, 'notes preserved')
assert.equal(loaded1.drafts[0]!.comments.length, 1, 'comments preserved')
assert.equal(loaded1.recoveryNotices[0]!.type, 'migration')
assert.equal(loaded1.recoveryNotices[0]!.preservedNotes, 2)
assert.ok(store.get(draftKey('ED-legacy')), 'legacy draft persisted')

// ---------- loadInitialState: corrupt draft + complete backup ----------
store.clear()
store.set('yy55-migrated', '1')
store.set(KEY_WORKING, JSON.stringify({ tracks: [track], comments: comments1 }))
store.set(draftKey('ED-02'), '{ broken json')
store.set(completeKey('ED-02'), JSON.stringify({
  id: 'D-ED-02', editorId: 'ED-02', editorName: '方亦', savedAt: '2026-10-02T08:00:00.000Z',
  basedOnBaselineId: null, tracks: [track], comments: comments1, changeLog: [], resolutions: {}, status: 'pending',
}))
store.set(logKey('ED-02'), JSON.stringify([
  { anchorType: 'note', anchorId: 'N1', field: 'dynamic', from: 'mp', to: 'f', time: '2026-10-02T09:00:00.000Z' },
  { anchorType: 'note', anchorId: 'N2', field: 'tie', from: false, to: true, time: '2026-10-02T09:30:00.000Z' },
]))
const loaded2 = loadInitialState()
assert.equal(loaded2.drafts.length, 1)
assert.equal(loaded2.drafts[0]!.editorId, 'ED-02')
assert.equal(loaded2.recoveryNotices.length, 1)
assert.equal(loaded2.recoveryNotices[0]!.type, 'recovery')
assert.equal(loaded2.recoveryNotices[0]!.lostItems!.length, 2, 'lost scope reported')

// ---------- loadInitialState: corrupt working copy falls back to baseline ----------
store.clear()
store.set(KEY_WORKING, '{ broken')
store.set(KEY_BASELINE, JSON.stringify({
  id: 'BL-1', label: '出版基线 v13', lockedAt: '2026-10-01T00:00:00.000Z',
  tracks: [track], comments: comments1, resolvedAtLock: [],
}))
const loaded3 = loadInitialState()
assert.equal(loaded3.tracks.length, 1, 'baseline restored')
assert.equal(loaded3.recoveryNotices[0]!.type, 'recovery')
assert.ok(loaded3.recoveryNotices[0]!.description.includes('出版基线'))

console.log('all merge logic tests passed')
