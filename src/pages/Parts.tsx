import { useMemo, useState } from 'react'
import { Alert, Button, InputNumber, Select, Space, Switch, Tag, Badge, List } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { selectAffectedParts } from '../store'
import { anchorLabel, FIELD_LABELS, formatFieldValue } from '../publishing'

export default function Parts() {
  const tracks = useSelector((state: RootState) => state.score.tracks)
  const affected = useSelector(selectAffectedParts)
  const [trackId, setTrackId] = useState(tracks[0]!.id)
  const [cue, setCue] = useState(true)
  const [pageTurn, setPageTurn] = useState(2)
  const track = tracks.find((item) => item.id === trackId)!
  const partAffected = affected[trackId]
  const totalAffected = useMemo(() => Object.values(affected).reduce((n, part) => n + part.noteChanges.length + part.commentCount, 0), [affected])

  return <main className="page">
    <div className="page-head no-print"><div><p className="eyebrow">分谱提取与出版排版</p><h1>演奏者分谱预览</h1><p>从总谱提取独立声部，单独调整换页、提示音、排练标记与打印分页；未合并的待合并改动会在对应声部标注。</p></div><Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印分谱</Button></div>

    {totalAffected > 0 && (
      <Alert
        style={{ marginBottom: 16 }}
        type="warning"
        showIcon
        message={`仍有 ${totalAffected} 项未合并改动影响分谱`}
        description="以下声部含有待合并草稿中的改动（音符调整或评论锚点），出版编辑逐项合并后才会进入出版基线；排练打印请以「待合并」标注为准。"
      />
    )}

    <div className="panel no-print" style={{ marginBottom: 16 }}>
      <Space wrap>
        <Select
          value={trackId}
          style={{ width: 240 }}
          options={tracks.map((item) => {
            const part = affected[item.id]
            const count = part ? part.noteChanges.length + part.commentCount : 0
            return {
              value: item.id,
              label: (
                <span>
                  {item.name} · {item.instrument}
                  {count > 0 && <Badge count={count} size="small" color="#cf1322" style={{ marginLeft: 8 }} />}
                </span>
              ),
            }
          })}
          onChange={setTrackId}
        />
        <span>换页前提示音：</span><InputNumber min={0} max={8} value={pageTurn} onChange={(value) => setPageTurn(value ?? 0)} /><span>小节</span>
        <Switch checked={cue} onChange={setCue} checkedChildren="显示提示音" unCheckedChildren="隐藏提示音" />
        <Tag color={track.transposition ? 'purple' : 'blue'}>{track.transposition ? `移调 ${track.transposition}` : '不移调'}</Tag>
        {partAffected && (partAffected.noteChanges.length + partAffected.commentCount) > 0
          ? <Tag color="red">待合并改动 {partAffected.noteChanges.length + partAffected.commentCount} 项</Tag>
          : <Tag color="green">已与出版基线同步</Tag>}
      </Space>
    </div>

    {partAffected && (partAffected.noteChanges.length + partAffected.commentCount) > 0 && (
      <Alert
        style={{ marginBottom: 16 }}
        type="error"
        showIcon
        message={`本声部受 ${partAffected.noteChanges.length + partAffected.commentCount} 项未合并改动影响（${partAffected.editors.join('、')}）`}
        description={
          <List
            size="small"
            dataSource={[
              ...partAffected.noteChanges.map(({ entry, measure }) => ({
                key: `n-${entry.anchorId}-${entry.field}`,
                text: `${anchorLabel({ anchorType: 'note', anchorId: entry.anchorId, measure })} · ${FIELD_LABELS[entry.field] ?? entry.field}：${formatFieldValue(entry.field, entry.from)} → ${formatFieldValue(entry.field, entry.to)}`,
              })),
              ...(partAffected.commentCount > 0 ? [{ key: 'c-comments', text: `另有 ${partAffected.commentCount} 条总谱级评论锚点改动（影响全部声部）` }] : []),
            ]}
            renderItem={(item) => <List.Item style={{ padding: '4px 0', border: 0 }}>{item.text}</List.Item>}
          />
        }
      />
    )}

    <article className="part-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0f172a', paddingBottom: 10 }}><div><h1 style={{ margin: 0, fontFamily: 'serif' }}>{track.name}</h1><small>{track.instrument} · 移调后记谱分谱</small></div><div style={{ textAlign: 'right' }}><b>《潮汐线》</b><div>沈青 作品</div><div>出版稿 v12{partAffected && (partAffected.noteChanges.length + partAffected.commentCount) > 0 && <Tag color="red" style={{ marginLeft: 6 }}>含未合并改动</Tag>}</div></div></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}><b>I. 潮起 · ♩ = 72</b><span>1</span></div>
      {[0, 1, 2].map((measureIndex) => <div key={measureIndex}><div className="part-measure">{track.notes.slice(measureIndex * 4, measureIndex * 4 + 4).map((note, index) => {
        const noteChanged = partAffected?.noteChanges.some(({ entry }) => entry.anchorId === note.id)
        return (
          <div key={note.id} className="part-note" style={noteChanged ? { background: '#fff1f0', borderRadius: 4 } : undefined}>
            <b>{note.key.replace('/', '')}</b><small style={{ display: 'block', color: '#64748b' }}>{note.dynamic}{note.tie ? ' ⁀' : ''}</small>
            {noteChanged && <Tag color="red" style={{ marginTop: 4, fontSize: 10, lineHeight: '16px' }}>待合并</Tag>}
            {cue && index === 0 && measureIndex > 0 && <em style={{ display: 'block', fontSize: 10, color: '#2563eb' }}>提示：{tracks[(tracks.indexOf(track) + 1) % tracks.length]!.name}</em>}
          </div>
        )
      })}</div>{measureIndex === 1 && <div style={{ textAlign: 'right', color: '#64748b', fontSize: 12 }}>换页 → 建议在第 {pageTurn + 4} 小节前</div>}</div>)}
      <div style={{ marginTop: 30, borderTop: '1px solid #94a3b8', paddingTop: 10, color: '#64748b', fontSize: 11 }}>© 2026 云谱出版社 · 仅限排练使用 · 禁止未授权复制</div>
    </article>
  </main>
}
