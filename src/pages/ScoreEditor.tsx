import { useEffect, useMemo, useRef } from 'react'
import { Alert, Button, Divider, Segmented, Select, Space, Tag, Tooltip, List, Badge } from 'antd'
import { DeleteOutlined, PlusOutlined, RedoOutlined, UndoOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import { Accidental, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import type { AppDispatch, RootState } from '../store'
import { addNote, redo, removeNote, selectNote, selectTrack, transposeTrack, undo, updateNote } from '../store'
import { diffDraft, fullTimeText, trackImpacts } from '../merge/engine'

export default function ScoreEditor() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.score)
  const { drafts, selectedTrackId, selectedNoteIndex, history, future, dirty, activeEditor } = state
  const draft = drafts.find((item) => item.editorId === activeEditor)!
  const tracks = draft.tracks
  const track = tracks.find((item) => item.id === selectedTrackId) ?? tracks[0]!
  const safeIndex = Math.min(selectedNoteIndex, track.notes.length - 1)
  const note = track.notes[safeIndex]
  const scoreRef = useRef<HTMLDivElement>(null)

  const myChanges = useMemo(() => diffDraft(draft, tracks), [draft, tracks])
  const impacts = useMemo(() => trackImpacts(drafts, state.canonicalTracks, state.comments), [drafts, state.canonicalTracks, state.comments])
  const currentTrackImpact = impacts.find((item) => item.trackId === track.id)

  useEffect(() => {
    const element = scoreRef.current
    if (!element) return
    element.innerHTML = ''
    const renderer = new Renderer(element, Renderer.Backends.SVG)
    renderer.resize(1060, 230)
    const context = renderer.getContext()
    const measures = [track.notes.slice(0, 4), track.notes.slice(4, 8), track.notes.slice(8, 12)]
    measures.forEach((measure, index) => {
      const stave = new Stave(index * 340, 22, 320).addClef(track.clef)
      if (index === 0) stave.addTimeSignature('4/4')
      stave.setContext(context).draw()
      const staveNotes = measure.map((item) => {
        const staveNote = new StaveNote({ keys: [item.key], duration: item.duration })
        if (item.accidental) staveNote.addModifier(new Accidental(item.accidental), 0)
        return staveNote
      })
      if (staveNotes.length) {
        const voice = new Voice({ num_beats: measure.reduce((sum, item) => sum + (item.duration === 'h' ? 2 : item.duration === 'q' ? 1 : .5), 0), beat_value: 4 })
        voice.addTickables(staveNotes)
        new Formatter().joinVoices([voice]).format([voice], 275)
        voice.draw(context, stave)
      }
      context.setFont('Arial', 11, 'normal').fillText(track.name, index * 340 + 10, 15)
      if (track.transposition) context.fillText(`移调 ${track.transposition > 0 ? '+' : ''}${track.transposition}`, index * 340 + 210, 15)
    })
  }, [track])

  const update = (patch: Record<string, unknown>) => dispatch(updateNote(patch as never))
  const changedIds = new Set(myChanges.map((change) => change.anchor.noteId))
  return <main className="page">
    <div className="page-head">
      <div>
        <p className="eyebrow">离线待合并草稿 · {draft.role} {draft.editorName}</p>
        <h1>多声部总谱</h1>
        <p>改动只进入「{draft.editorName}」的待合并草稿，按音符/评论锚点记录来源与时间；网络恢复后由出版编辑在合并台逐项处理，冲突不会静默覆盖。</p>
      </div>
      <Space>
        <Tag color={dirty ? 'orange' : 'green'}>{dirty ? `草稿已离线保存 · ${fullTimeText(draft.updatedAt)}` : '草稿无改动'}</Tag>
        <Tooltip title="撤销（仅本草稿）"><Button icon={<UndoOutlined />} disabled={!history.length} onClick={() => dispatch(undo())} /></Tooltip>
        <Tooltip title="重做"><Button icon={<RedoOutlined />} disabled={!future.length} onClick={() => dispatch(redo())} /></Tooltip>
      </Space>
    </div>
    <div className="score-toolbar">
      <Segmented value={track.id} options={tracks.map((item) => ({ label: <span>{item.name}{impacts.find((impact) => impact.trackId === item.id)?.pending ? <Badge status="processing" /> : null}</span>, value: item.id }))} onChange={(value) => dispatch(selectTrack(String(value)))} />
      <span style={{ flex: 1 }} />
      <Button onClick={() => dispatch(transposeTrack(-1))}>降半音</Button>
      <Button onClick={() => dispatch(transposeTrack(1))}>升半音</Button>
      <Select value={track.transposition} style={{ width: 120 }} options={[-12,-7,-5,-2,0,2,5,7,12].map((value)=>({value,label:`移调 ${value > 0 ? '+' : ''}${value}`}))} onChange={(value) => dispatch(transposeTrack(value - track.transposition))} />
    </div>
    <Alert
      type={currentTrackImpact?.conflicts ? 'error' : 'warning'}
      showIcon
      style={{ marginBottom: 12 }}
      message={
        currentTrackImpact?.conflicts
          ? `该声部有 ${currentTrackImpact.conflicts} 项冲突/阻塞项，必须由出版编辑逐项选边，不会自动覆盖`
          : currentTrackImpact?.pending
            ? `该声部有 ${currentTrackImpact.pending} 项来自其他编辑的待合并改动`
            : `${track.instrument} · 草稿隔离编辑中`
      }
      description={myChanges.length ? `本草稿已记录 ${myChanges.length} 处锚点改动，最近更新 ${fullTimeText(draft.updatedAt)}；分谱页会持续提示该声部受未合并改动影响。` : '本草稿尚未偏离合并基线。'}
    />
    <div className="score-grid">
      <section>
        <div className="score-canvas-wrap" ref={scoreRef} />
        <div className="note-strip">{track.notes.map((item,index)=><button key={item.id} className={`note-chip ${index===selectedNoteIndex?'active':''} ${changedIds.has(item.id)?'changed':''}`} onClick={()=>dispatch(selectNote(index))}><b>{index+1}</b><small>{item.key.replace('/', '')} · {item.dynamic}</small>{changedIds.has(item.id) && <em className="chip-dot">改</em>}</button>)}</div>
        <Space wrap><Button icon={<PlusOutlined />} onClick={()=>dispatch(addNote())}>添加音符</Button><Button danger icon={<DeleteOutlined />} onClick={()=>dispatch(removeNote())}>删除当前</Button><Button onClick={()=>update({ duration: note?.duration === 'q' ? 'h' : note?.duration === 'h' ? '8' : 'q' })}>切换时值</Button><Button onClick={()=>update({ tie: !note?.tie })}>{note?.tie ? '取消延音' : '增加延音'}</Button><Button onClick={()=>update({ accidental: note?.accidental ? undefined : '#' })}>{note?.accidental ? '移除临时记号' : '增加升号'}</Button></Space>
      </section>
      <aside className="panel">
        <h3>音符属性（草稿）</h3>
        <label>力度</label><Select value={note?.dynamic} style={{width:'100%'}} options={['pp','p','mp','mf','f','ff'].map((value)=>({value,label:value}))} onChange={(value)=>update({ dynamic:value })} />
        <label>表情标记</label><Select value={note?.expression} allowClear style={{width:'100%'}} options={[{value:'dolce',label:'dolce 柔和地'},{value:'cantabile',label:'cantabile 如歌地'},{value:'marcato',label:'marcato 着重地'}]} onChange={(value)=>update({ expression:value ?? '' })} />
        <Divider /><h3>本草稿改动锚点</h3>
        <List
          size="small"
          dataSource={myChanges.slice(-8).reverse()}
          locale={{ emptyText: '暂无改动' }}
          renderItem={(change) => <List.Item><span>{change.label}</span><Tag>{fullTimeText(change.time).slice(6)}</Tag></List.Item>}
        />
      </aside>
    </div>
  </main>
}
