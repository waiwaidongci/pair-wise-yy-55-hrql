import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Tag, Tabs, Timeline, Alert, Space, Empty, Table } from 'antd'
import { CheckOutlined, CommentOutlined, LockOutlined, MergeCellsOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { confirmCommentRecheck, lockBaseline, resolveComment } from '../store'
import { buildMergeQueue, fullTimeText } from '../merge/engine'

export default function Versions() {
  const dispatch = useDispatch<AppDispatch>()
  const navigate = useNavigate()
  const { versions, comments, drafts, canonicalTracks, decisions, baseline, activeEditor, online } = useSelector((state: RootState) => state.score)
  const queue = useMemo(() => buildMergeQueue(drafts, canonicalTracks, comments, decisions), [drafts, canonicalTracks, comments, decisions])
  const pendingCount = queue.filter((item) => !item.decided).length
  const conflictCount = queue.filter((item) => item.status === 'conflict').length
  const canLock = activeEditor === 'publisher' && online

  return <main className="page">
    <div className="page-head">
      <div><p className="eyebrow">版本、评论与出版基线</p><h1>差异比较与审阅</h1><p>评论锚定小节并跟随草稿隔离；总谱合并后旧基线与相关评论结论立即失效重算。</p></div>
      <Space>
        <Button icon={<MergeCellsOutlined />} onClick={() => navigate('/merge')}>前往合并台{pendingCount ? `（待处理 ${pendingCount}）` : ''}</Button>
        <Button type="primary" icon={<LockOutlined />} disabled={!canLock} onClick={() => dispatch(lockBaseline())}>按当前总谱锁定出版基线</Button>
      </Space>
    </div>

    {baseline?.status === 'invalid' && (
      <Alert type="error" showIcon style={{ marginBottom: 14 }}
        message={`出版基线 ${baseline.id} 已随合并失效：${baseline.staleAnchors.length} 个锚点偏离，相关评论结论需要复核`}
        action={<Button size="small" danger onClick={() => navigate('/merge')}>去重算/重锁</Button>}
      />
    )}

    <Tabs items={[
      {
        key: 'baseline',
        label: <span><SafetyCertificateOutlined /> 出版基线 {baseline && <Tag color={baseline.status === 'valid' ? 'green' : 'red'} style={{ marginInlineStart: 4 }}>{baseline.status === 'valid' ? '有效' : '失效'}</Tag>}</span>,
        children: baseline ? (
          <Card title={`${baseline.title} · ${baseline.lockedBy} · ${fullTimeText(baseline.lockedAt)}`}>
            {baseline.status === 'valid'
              ? <Alert type="success" showIcon message="基线指纹与当前总谱一致，分谱可据此付印。" />
              : <Table rowKey={(row) => `${row.anchor.kind}-${row.label}-${row.detail}`} size="small" pagination={{ pageSize: 10 }} dataSource={baseline.staleAnchors} columns={[
                { title: '失效锚点', dataIndex: 'label' },
                { title: '重算结果', dataIndex: 'detail' },
              ]} />}
          </Card>
        ) : <Empty description="尚无基线" />,
      },
      {
        key: 'comments',
        label: `评论锚点 (${comments.filter((item) => !item.resolved).length} 待处理${comments.some((item) => item.needsRecheck) ? ` · ${comments.filter((item) => item.needsRecheck).length} 结论失效` : ''})`,
        children: <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .7fr', gap: 16 }}>
          <Card>
            {comments.map((comment) => (
              <div key={comment.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 12, padding: '14px 0', borderBottom: '1px solid #edf0f5' }}>
                <Tag icon={<CommentOutlined />}>第 {comment.measure} 小节</Tag>
                <div>
                  <b>{comment.author}</b>
                  <p style={{ margin: '4px 0' }}>{comment.content}</p>
                  {comment.needsRecheck
                    ? <Tag color="red">结论随基线 {comment.resolvedBaselineId} 失效，待出版复核</Tag>
                    : comment.resolved
                      ? <Tag color="green">已解决{comment.resolvedBaselineId ? ` · 基线 ${comment.resolvedBaselineId}` : ''}</Tag>
                      : null}
                </div>
                <div>
                  {comment.needsRecheck
                    ? <Button size="small" type="primary" disabled={!canLock} onClick={() => dispatch(confirmCommentRecheck(comment.id))}>复核通过</Button>
                    : comment.resolved
                      ? <Tag color="green">已解决</Tag>
                      : <Button size="small" onClick={() => dispatch(resolveComment(comment.id))}>在当前草稿处理</Button>}
                </div>
              </div>
            ))}
            <p className="muted" style={{ marginTop: 10 }}>「在当前草稿处理」只写入当前编辑的待合并草稿，需出版合并后才进入总谱，不会覆盖他人的评论处理。</p>
          </Card>
          <Card title="待决事项">
            <Alert
              type={conflictCount ? 'error' : 'warning'} showIcon
              message={conflictCount ? `${conflictCount} 个锚点存在来源冲突` : pendingCount ? `${pendingCount} 个锚点改动待逐项合并` : '没有待合并改动'}
              description="冲突按来源与时间并列展示，出版编辑必须显式选边；系统不会以最后保存者为准。"
              style={{ marginBottom: 12 }}
            />
            <Button block icon={<MergeCellsOutlined />} onClick={() => navigate('/merge')}>进入逐项合并</Button>
          </Card>
        </div>,
      },
      {
        key: 'diff',
        label: '历史版本',
        children: <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>{versions.slice(0, 2).map((version) => <Card key={version.id} title={<span>{version.id} · {version.author} <Tag>{version.time}</Tag></span>}><p>{version.summary}</p>{Object.entries(version.trackNotes).map(([trackId, notes]) => <div className="diff-row" key={trackId}><Tag color="red">声部</Tag><span>{trackId}</span><b>{notes.length} 个音符</b></div>)}</Card>)}</div>,
      },
      {
        key: 'timeline',
        label: '操作与合并历史',
        children: <Card>
          <Timeline items={[
            ...useMergeJournal(),
            { color: 'gray', children: '14:10 赵晴锁定出版基线 v12（排练前）' },
            { color: 'gray', children: '更早：14:10 发布 v11 单簧管移调分谱' },
          ]} />
        </Card>,
      },
    ]} />
  </main>
}

function useMergeJournal() {
  const { drafts } = useSelector((state: RootState) => state.score)
  return drafts
    .flatMap((draft) => draft.journal.map((entry) => ({ draft, entry })))
    .sort((a, b) => b.entry.time - a.entry.time)
    .map(({ draft, entry }) => ({ color: draft.editorId === 'conductor' ? 'blue' : draft.editorId === 'composer' ? 'green' : 'purple', children: `${fullTimeText(entry.time)} ${draft.editorName}（离线草稿 #${entry.seq}）：${entry.label}` }))
}
