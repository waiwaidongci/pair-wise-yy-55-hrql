import { useMemo, useState } from 'react'
import { Alert, Badge, Button, InputNumber, Select, Space, Switch, Tag, Tooltip } from 'antd'
import { PrinterOutlined, WarningOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { RootState } from '../store'
import { buildMergeQueue, formatValue, fullTimeText, trackImpacts, type MergeItem } from '../merge/engine'

export default function Parts() {
  const { canonicalTracks, drafts, comments, decisions, baseline } = useSelector((state: RootState) => state.score)
  const tracks = canonicalTracks
  const [trackId, setTrackId] = useState(tracks[0]!.id)
  const [cue, setCue] = useState(true)
  const [pageTurn, setPageTurn] = useState(2)
  const track = tracks.find((item) => item.id === trackId)!

  const impacts = useMemo(() => trackImpacts(drafts, canonicalTracks, comments), [drafts, canonicalTracks, comments])
  const queue = useMemo(() => buildMergeQueue(drafts, canonicalTracks, comments, decisions), [drafts, canonicalTracks, comments, decisions])
  const itemsForTrack = queue.filter((item) => item.trackId === trackId && item.kind === 'note')
  const impactMap = new Map(impacts.map((impact) => [impact.trackId, impact]))

  const itemOfNote = (noteId: string): MergeItem[] => itemsForTrack.filter((item) => item.noteId === noteId)

  return <main className="page">
    <div className="page-head no-print">
      <div><p className="eyebrow">分谱提取与出版排版</p><h1>演奏者分谱预览</h1><p>分谱只取自已合并总谱；任何声部仍受未合并改动影响时都会显式标出，冲突未逐项处理前不进入排版。</p></div>
      <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印分谱</Button>
    </div>

    {baseline?.status === 'invalid' && (
      <Alert
        className="no-print"
        type="error" showIcon banner style={{ marginBottom: 12 }}
        message="出版基线已失效：总谱接受合并后，旧基线与其评论结论立即失效，正在按锚点重算"
        description={`失效锚点 ${baseline.staleAnchors.length} 处；受影响小节的已解决评论已被要求复核。重锁基线后此分谱版本号才会更新。`}
      />
    )}

    <div className="panel no-print" style={{ marginBottom: 16 }}>
      <Space wrap>
        <Select
          value={trackId} style={{ width: 260 }}
          options={tracks.map((item) => {
            const impact = impactMap.get(item.id)
            return {
              value: item.id,
              label: <Space size={6}><span>{item.name} · {item.instrument}</span>{impact?.conflicts ? <Tag color="red" style={{ marginInlineEnd: 0 }}>冲突 {impact.conflicts}</Tag> : impact?.pending ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>待合并 {impact.pending}</Tag> : <Tag color="green" style={{ marginInlineEnd: 0 }}>已同步</Tag>}</Space>,
            }
          })}
          optionRender={(option) => option.label}
          onChange={setTrackId}
        />
        <span>换页前提示音：</span><InputNumber min={0} max={8} value={pageTurn} onChange={(value) => setPageTurn(value ?? 0)} /><span>小节</span>
        <Switch checked={cue} onChange={setCue} checkedChildren="显示提示音" unCheckedChildren="隐藏提示音" />
        <Tag color={track.transposition ? 'purple' : 'blue'}>{track.transposition ? `移调 ${track.transposition}` : '不移调'}</Tag>
      </Space>
      <PartsImpactTrack />
    </div>

    <article className="part-page">
      <div style={{display:'flex',justifyContent:'space-between',borderBottom:'2px solid #0f172a',paddingBottom:10}}>
        <div><h1 style={{margin:0,fontFamily:'serif'}}>{track.name}</h1><small>{track.instrument} · 移调后记谱分谱</small></div>
        <div style={{textAlign:'right'}}><b>《潮汐线》</b><div>沈青 作品</div><div>{baseline ? baseline.id : '无基线'}{baseline?.status === 'invalid' && <Tag color="red" style={{ marginLeft: 6 }}>基线失效重算中</Tag>}</div></div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:10}}><b>I. 潮起 · ♩ = 72</b><span>1</span></div>
      {[0,1,2].map((measureIndex) => (
        <div key={measureIndex}>
          <div className="part-measure">
            {track.notes.slice(measureIndex*4, measureIndex*4+4).map((note,index) => {
              const noteItems = itemOfNote(note.id)
              const conflict = noteItems.some((item) => item.status === 'conflict' || item.status === 'blocked')
              const pending = noteItems.length > 0
              return (
                <div key={note.id} className={`part-note ${conflict ? 'note-conflict' : pending ? 'note-pending' : ''}`}>
                  <b>{note.key.replace('/', '')}</b>
                  <small style={{display:'block',color:'#64748b'}}>{note.dynamic}{note.tie ? ' ⁀' : ''}</small>
                  {conflict && <Tag color="red" style={{ marginTop: 4 }} icon={<WarningOutlined />}>冲突待选边</Tag>}
                  {!conflict && pending && <Tag color="orange" style={{ marginTop: 4 }}>有未合并改动</Tag>}
                  {cue && index===0 && measureIndex>0 && <em style={{display:'block',fontSize:10,color:'#2563eb'}}>提示：{tracks[(tracks.indexOf(track)+1)%tracks.length]!.name}</em>}
                </div>
              )
            })}
          </div>
          {measureIndex===1 && <div style={{textAlign:'right',color:'#64748b',fontSize:12}}>换页 → 建议在第 {pageTurn+4} 小节前</div>}
        </div>
      ))}
      <PendingDetail items={itemsForTrack} />
      <div style={{marginTop:30,borderTop:'1px solid #94a3b8',paddingTop:10,color:'#64748b',fontSize:11}}>© 2026 云谱出版社 · 仅限排练使用 · 禁止未授权复制{baseline?.status === 'invalid' && ' · 本稿基于失效基线，请勿付印'}</div>
    </article>
  </main>
}

function PartsImpactTrack() {
  const { drafts, canonicalTracks, comments, decisions } = useSelector((state: RootState) => state.score)
  const queue = useMemo(() => buildMergeQueue(drafts, canonicalTracks, comments, decisions), [drafts, canonicalTracks, comments, decisions])
  const byTrack = new Map<string, MergeItem[]>()
  queue.filter((item) => item.trackId).forEach((item) => {
    byTrack.set(item.trackId!, [...(byTrack.get(item.trackId!) ?? []), item])
  })
  return (
    <div style={{ marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      {canonicalTracks.map((track) => {
        const items = byTrack.get(track.id) ?? []
        const conflictCount = items.filter((item) => item.status === 'conflict' || item.status === 'blocked').length
        return (
          <Tooltip key={track.id} title={items.length ? `${items.length} 个锚点字段待合并，涉及 ${[...new Set(items.flatMap((item) => item.changes.map((change) => change.editorId)))].length} 位编辑` : '无未合并改动'}>
            <span className="impact-chip">
              <Badge status={conflictCount ? 'error' : items.length ? 'warning' : 'success'} text={track.name} />
              {items.length > 0 && <small> {conflictCount ? `冲突 ${conflictCount}` : `待合并 ${items.length}`} · {fullTimeText(Math.max(...items.flatMap((item) => item.changes.map((change) => change.time))))}</small>}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}

function PendingDetail({ items }: { items: MergeItem[] }) {
  if (!items.length) return null
  return (
    <div className="no-print" style={{ marginTop: 16, border: '1px dashed #f59e0b', borderRadius: 6, padding: '8px 12px' }}>
      <b>本声部未合并锚点（{items.length}）：</b>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {items.map((item) => (
          <li key={item.id} style={{ color: item.status === 'clean' ? '#92400e' : '#b91c1c' }}>
            {item.label} · {item.fieldLabel}：{item.changes.map((change) => `${change.editorId === 'conductor' ? '指挥' : change.editorId === 'composer' ? '作曲' : '出版'} ${fullTimeText(change.time).slice(5)}→${formatValue(change.newValue)}`).join('；')}
          </li>
        ))}
      </ul>
    </div>
  )
}
