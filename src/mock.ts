import type { EditorProfile, PendingDraft, PublishingBaseline, ScoreComment, ScoreNote, ScoreVersion, Track } from './types'

const notes = (keys: string[]): ScoreNote[] => keys.map((key, index) => ({ id: `N-${index + 1}`, key, duration: index % 4 === 0 ? 'h' : 'q', dynamic: index < 2 ? 'mp' : 'mf', tie: index === 2, expression: index === 3 ? 'dolce' : '' }))

export const seedTracks: Track[] = [
  { id: 'TR-01', name: '长笛', instrument: 'Flute', clef: 'treble', transposition: 0, color: '#2563eb', notes: notes(['c/5','d/5','e/5','g/5','a/5','g/5','e/5','d/5','c/5','e/5','g/5','a/5']) },
  { id: 'TR-02', name: '单簧管', instrument: 'Clarinet in Bb', clef: 'treble', transposition: -2, color: '#7c3aed', notes: notes(['d/4','e/4','f/4','a/4','c/5','a/4','f/4','e/4','d/4','f/4','a/4','c/5']) },
  { id: 'TR-03', name: '圆号', instrument: 'Horn in F', clef: 'treble', transposition: -7, color: '#d97706', notes: notes(['g/3','a/3','c/4','d/4','e/4','d/4','c/4','a/3','g/3','c/4','d/4','e/4']) },
  { id: 'TR-04', name: '大提琴', instrument: 'Violoncello', clef: 'bass', transposition: 0, color: '#059669', notes: notes(['c/3','g/3','e/3','d/3','c/3','g/3','a/3','g/3','c/3','e/3','g/3','a/3']) },
]

export const seedComments: ScoreComment[] = [
  { id: 'CM-1', measure: 2, author: '指挥 · 方亦', content: '圆号第 2 小节进入需再弱一级，避免覆盖大提琴主题。', resolved: false },
  { id: 'CM-2', measure: 3, author: '作曲 · 沈青', content: '第 3 小节末音增加延音线，与下一小节第一拍连奏。', resolved: false },
  { id: 'CM-3', measure: 6, author: '出版 · 赵晴', content: '单簧管分谱需在换页处保留 2 小节提示音。', resolved: true, resolvedAt: 0, resolvedBaselineId: 'v12' },
  { id: 'CM-4', measure: 2, author: '出版 · 赵晴', content: '圆号第 2 小节与大提琴的平衡已按上轮排练确认，付印时勿改力度。', resolved: true, resolvedAt: 0, resolvedBaselineId: 'v12' },
]

export const seedVersions: ScoreVersion[] = [
  { id: 'v12', author: '沈青', time: '今天 16:28', summary: '调整终段和声，补充圆号力度与连音线', trackNotes: { 'TR-03': seedTracks[2]!.notes } },
  { id: 'v11', author: '方亦', time: '今天 14:10', summary: '移调单簧管分谱并调整换气标记', trackNotes: { 'TR-02': seedTracks[1]!.notes } },
]

export const editors: EditorProfile[] = [
  { id: 'conductor', name: '方亦', role: '指挥' },
  { id: 'composer', name: '沈青', role: '作曲' },
  { id: 'publisher', name: '赵晴', role: '出版编辑' },
]

const todayAt = (hour: number, minute: number) => {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

/** 排练断网时三方各自的待合并草稿：指挥与作曲对圆号第 2 小节力度给出冲突结论 */
export function buildSeedDrafts(): PendingDraft[] {
  const make = (editor: EditorProfile, updatedAt: number, mutate: (tracks: Track[], comments: ScoreComment[]) => void): PendingDraft => {
    const tracks = structuredClone(seedTracks)
    const comments = structuredClone(seedComments)
    mutate(tracks, comments)
    return {
      id: `draft-${editor.id}`,
      editorId: editor.id,
      editorName: editor.name,
      role: editor.role,
      createdAt: todayAt(15, 40),
      updatedAt,
      baseTracks: structuredClone(seedTracks),
      baseComments: structuredClone(seedComments),
      tracks,
      comments,
      journal: [],
      rebaseConflicts: [],
    }
  }

  return [
    make(editors[0]!, todayAt(16, 52), (tracks, comments) => {
      // 指挥：圆号第 2 小节（N-5，index 4）力度降到 p，并把自己的评论标为已处理
      tracks[2]!.notes[4]!.dynamic = 'p'
      const comment = comments.find((item) => item.id === 'CM-1')!
      comment.resolved = true
      comment.resolvedAt = todayAt(16, 52)
    }),
    make(editors[1]!, todayAt(16, 57), (tracks) => {
      // 作曲：同一音符认为应保持 mp 弱进即可；另把第 3 小节末音加延音线
      tracks[2]!.notes[4]!.dynamic = 'mp'
      tracks[2]!.notes[7]!.tie = true
    }),
    make(editors[2]!, todayAt(16, 40), () => { /* 出版草稿暂空，等待联网逐项合并 */ }),
  ]
}

export function seedJournals(): Record<string, import('./types').JournalEntry[]> {
  const j = (seq: number, hour: number, minute: number, editorId: import('./types').EditorId, label: string, anchorText: string): import('./types').JournalEntry => ({ seq, time: todayAt(hour, minute), editorId, label, anchorText })
  return {
    'draft-conductor': [
      j(1, 16, 41, 'conductor', '圆号 第 2 小节第 1 拍 · 力度 mf → p', '圆号 第 2 小节第 1 拍'),
      j(2, 16, 52, 'conductor', '标记评论 CM-1 为已处理', '评论 CM-1 · 第 2 小节'),
    ],
    'draft-composer': [
      j(1, 16, 47, 'composer', '圆号 第 2 小节第 1 拍 · 力度 mf → mp', '圆号 第 2 小节第 1 拍'),
      j(2, 16, 57, 'composer', '圆号 第 3 小节第 4 拍 · 延音线 是', '圆号 第 3 小节第 4 拍'),
    ],
    'draft-publisher': [],
  }
}

/** 把排练前的操作流水挂到种子草稿上 */
export function withSeedJournals(drafts: PendingDraft[]): PendingDraft[] {
  const journals = seedJournals()
  return drafts.map((draft) => ({ ...draft, journal: structuredClone(journals[draft.id] ?? []) }))
}

export function buildSeedBaseline(): PublishingBaseline {
  return {
    id: 'v12',
    title: '出版稿 v12（排练前锁定）',
    lockedAt: todayAt(14, 10),
    lockedBy: '赵晴',
    trackNotes: Object.fromEntries(seedTracks.map((track) => [track.id, structuredClone(track.notes)])),
    trackTranspositions: Object.fromEntries(seedTracks.map((track) => [track.id, track.transposition])),
    comments: structuredClone(seedComments),
    status: 'valid',
    staleAnchors: [],
  }
}
