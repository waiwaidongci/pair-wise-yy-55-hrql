import assert from 'node:assert'

// Mocks must be in place before store import (loadInitialState reads localStorage at import time)
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
} as Storage
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

const { store, selectReview, selectBaselineStale, selectAffectedParts, selectScoreView } = await import('./src/store')
const { updateNote, selectTrack, selectNote, lockBaseline, acceptMergeItem, rejectMergeItem, setCurrentEditor, resolveComment } = await import('./src/store')

// initial state
assert.equal(store.getState().score.tracks.length, 4)
assert.equal(store.getState().score.drafts.length, 0)
assert.equal(store.getState().score.baseline, null)

// editor 1 edits note 2 of TR-01 → goes to draft, working copy untouched
store.dispatch(updateNote({ dynamic: 'f' }))
let s = store.getState().score
assert.equal(s.tracks[0]!.notes[2]!.dynamic, 'mf', 'working copy untouched by draft edit')
assert.equal(s.drafts.length, 1, 'draft created for editor 1')
assert.equal(s.drafts[0]!.editorId, 'ED-01')
assert.equal(s.drafts[0]!.tracks[0]!.notes[2]!.dynamic, 'f', 'draft snapshot updated')
assert.equal(s.drafts[0]!.changeLog.length, 1)
assert.equal(s.drafts[0]!.changeLog[0]!.field, 'dynamic')
assert.equal(s.drafts[0]!.changeLog[0]!.from, 'mf')
assert.equal(s.drafts[0]!.changeLog[0]!.to, 'f')

// offline persistence: draft + complete backup written before any merge
assert.ok(mem.get('yy55-draft-ED-01'), 'editor draft persisted offline')
assert.ok(mem.get('yy55-complete-ED-01'), 'complete backup persisted')

// score view shows the draft
const view = selectScoreView(store.getState())
assert.equal(view.tracks[0]!.notes[2]!.dynamic, 'f', 'score editor shows draft')
assert.equal(view.isDraft, true)

// editor 2 edits a different note → own draft (seed has tie=true at index 2)
store.dispatch(setCurrentEditor('ED-02'))
store.dispatch(selectTrack('TR-02'))
store.dispatch(selectNote(2))
store.dispatch(updateNote({ tie: false }))
s = store.getState().score
assert.equal(s.drafts.length, 2, 'each editor has own draft')
assert.equal(s.drafts[1]!.editorId, 'ED-02')
assert.equal(s.drafts[1]!.tracks[1]!.notes[2]!.tie, false, 'draft snapshot updated')
assert.equal(s.tracks[1]!.notes[2]!.tie, true, 'working copy untouched (seed value)')

// review: both clean (different anchors, not in working copy)
let review = selectReview(store.getState())
assert.equal(review.length, 2)
assert.ok(review.every((i) => i.status === 'clean'), 'different anchors → clean')

// conflict: editor 2 changes the same note editor 1 changed, to a different value
store.dispatch(setCurrentEditor('ED-02'))
store.dispatch(selectTrack('TR-01'))
store.dispatch(selectNote(2))
store.dispatch(updateNote({ dynamic: 'p' }))
review = selectReview(store.getState())
const conflict = review.find((i) => i.anchorId === 'N-3' && i.field === 'dynamic')
assert.ok(conflict, 'conflict item exists')
assert.equal(conflict!.status, 'conflict', 'same anchor different value → conflict, not silent overwrite')
assert.equal(conflict!.candidates.length, 2)

// resolve a comment and merge it into working copy, then lock baseline
store.dispatch(setCurrentEditor('ED-01'))
store.dispatch(resolveComment('CM-1'))
const commentItem = selectReview(store.getState()).find((i) => i.anchorId === 'CM-1')!
assert.equal(commentItem.status, 'clean')
store.dispatch(acceptMergeItem({ key: commentItem.key }))
assert.equal(store.getState().score.comments.find((c) => c.id === 'CM-1')!.resolved, true, 'comment resolved in working copy')
store.dispatch(lockBaseline())
s = store.getState().score
assert.ok(s.baseline)
assert.equal(selectBaselineStale(store.getState()), false)

// edit score → baseline invalidated, comment conclusion reopened
store.dispatch(updateNote({ expression: 'dolce' }))
assert.equal(selectBaselineStale(store.getState()), true, 'baseline stale after score change')
const cm1 = store.getState().score.comments.find((c) => c.id === 'CM-1')!
assert.equal(cm1.resolved, false, 'comment conclusion invalidated')
assert.equal(cm1.invalidated, true, 'comment marked for recompute')

// publishing editor resolves conflict by choosing editor 1's value → applies to working copy
store.dispatch(acceptMergeItem({ key: conflict!.key, candidateDraftId: conflict!.candidates.find((c) => c.editorId === 'ED-01')!.draftId }))
s = store.getState().score
assert.equal(s.tracks[0]!.notes[2]!.dynamic, 'f', 'chosen value merged into working copy')

// merge remaining clean items one by one
for (const item of selectReview(store.getState()).filter((i) => i.status === 'clean')) {
  store.dispatch(acceptMergeItem({ key: item.key }))
}
s = store.getState().score
assert.equal(s.tracks[1]!.notes[2]!.tie, false, 'tie merged into working copy')
assert.equal(s.tracks[0]!.notes[2]!.expression, 'dolce', 'expression merged into working copy')
assert.equal(s.drafts.find((d) => d.editorId === 'ED-01')!.status, 'merged', 'editor 1 draft merged')
assert.equal(s.drafts.find((d) => d.editorId === 'ED-02')!.status, 'rejected', 'editor 2 draft rejected (conflict lost)')

// reject does not change working copy
const before = s.tracks[0]!.notes[2]!.dynamic
store.dispatch(rejectMergeItem(conflict!.key))
assert.equal(store.getState().score.tracks[0]!.notes[2]!.dynamic, before, 'reject does not change working copy')

// affected parts selector
const affected = selectAffectedParts(store.getState())
assert.ok(Object.keys(affected).length >= 0, 'affected parts selector runs')

// working copy autosaved offline
assert.ok(mem.get('yy55-score-draft'), 'working copy autosaved')

console.log('store smoke test passed')
