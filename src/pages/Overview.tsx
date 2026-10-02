import { Alert, Button, Card, Col, Progress, Row, Table, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { scoreApi } from '../store'
import { buildMergeQueue, trackImpacts } from '../merge/engine'

export default function Overview() {
  const navigate = useNavigate()
  const { canonicalTracks, comments, drafts, decisions, baseline, online } = useSelector((state: RootState) => state.score)
  const { data } = scoreApi.endpoints.getPublishingProfile.useQuery()
  const queue = useMemo(() => buildMergeQueue(drafts, canonicalTracks, comments, decisions), [drafts, canonicalTracks, comments, decisions])
  const impacts = useMemo(() => trackImpacts(drafts, canonicalTracks, comments), [drafts, canonicalTracks, comments])
  const conflicts = queue.filter((item) => item.status === 'conflict' || item.status === 'blocked').length
  const pending = queue.length
  const recheckCount = comments.filter((item) => item.needsRecheck).length

  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">乐谱、移调与出版准备</p><h1>{data?.title ?? '总谱出版工作台'}</h1><p>每位编辑的改动先离线进入各自待合并草稿；网络恢复后由出版编辑按锚点逐项合并，冲突显式选边。</p></div><Button type="primary" onClick={() => navigate('/merge')}>进入离线合并台</Button></div>
    <Row gutter={[14,14]} className="metrics"><Col xs={24} sm={12} xl={6}><Card className="metric"><span>待合并锚点</span><strong style={{ color: pending ? '#d97706' : undefined }}>{pending}</strong><small>来自 {drafts.filter((draft) => draft.journal.length).length} 份离线草稿</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric" style={{ borderLeftColor: conflicts ? '#dc2626' : undefined }}><span>冲突/阻塞</span><strong style={{ color: conflicts ? '#dc2626' : undefined }}>{conflicts}</strong><small>必须逐项选边，不静默覆盖</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>待处理评论</span><strong>{comments.filter((item) => !item.resolved).length}</strong><small>{recheckCount ? `另有 ${recheckCount} 条结论失效待复核` : '指挥与作曲意见'}</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>出版基线</span><strong style={{ fontSize: 22 }}>{baseline?.id ?? '—'}</strong><small>{baseline?.status === 'valid' ? '指纹有效 · 可付印' : '已失效 · 重算中'}</small></Card></Col></Row>
    {(conflicts > 0 || !online) && <Alert type={conflicts ? 'error' : 'info'} showIcon message={conflicts ? `有 ${conflicts} 个锚点冲突待出版编辑逐项选边` : '排练离线中，编辑改动均已进入待合并草稿并本地保存'} description={conflicts ? '例如圆号第 2 小节力度：指挥与作曲给出不同结论，晚提交不再覆盖早提交。' : '网络恢复后切换到出版编辑即可在合并台处理。'} action={<Button size="small" onClick={() => navigate('/merge')}>查看合并台</Button>} style={{ marginBottom: 16 }} />}
    <Row gutter={[16,16]}><Col xs={24} xl={16}><Card title="声部与未合并影响"><Table rowKey="trackId" pagination={false} dataSource={canonicalTracks.map((track) => ({ ...track, impact: impacts.find((item) => item.trackId === track.id)! }))} columns={[{title:'声部',dataIndex:'name'},{title:'乐器',dataIndex:'instrument'},{title:'移调',render:(_value,row)=><Tag color={row.transposition ? 'purple' : 'blue'}>{row.transposition ? `${row.transposition > 0 ? '+' : ''}${row.transposition} 半音` : '不移调'}</Tag>},{title:'音符',render:(_value,row)=>`${row.notes.length} 音`},{title:'未合并影响',render:(_value,row)=>row.impact.conflicts ? <Tag color="red">冲突 {row.impact.conflicts} · 待合并 {row.impact.pending}</Tag> : row.impact.pending ? <Tag color="orange">待合并 {row.impact.pending}</Tag> : <Tag color="green">与总谱同步</Tag>}]} /></Card></Col><Col xs={24} xl={8}><Card title="出版检查"><div className="check-row"><span>草稿离线隔离</span><b className="success">就绪</b></div><div className="check-row"><span>锚点冲突显式化</span><b className={conflicts ? 'danger' : 'success'}>{conflicts ? `${conflicts} 项待选边` : '无冲突'}</b></div><div className="check-row"><span>基线指纹重算</span><b className={baseline?.status === 'valid' ? 'success' : 'danger'}>{baseline?.status === 'valid' ? '有效' : '已失效'}</b></div><div className="check-row"><span>离线检查点</span><b className="success">三代轮转</b></div><Progress percent={Math.max(20, 100 - conflicts * 20 - recheckCount * 10)} strokeColor="#2563eb" /><p className="muted">出版编辑在线逐项合并并复核评论后，可重锁基线交付，预计交付 {data?.deadline ?? '2026-10-12'}。</p></Card></Col></Row>
  </main>
}
