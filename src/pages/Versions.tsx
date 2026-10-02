import { useMemo, useState } from 'react'
import { Alert, Button, Card, Tag, Tabs, Timeline, Space, Statistic, Empty, Tooltip, Badge } from 'antd'
import { CheckOutlined, CloseOutlined, CloudOutlined, CloudSyncOutlined, CommentOutlined, LockOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { acceptMergeItem, lockBaseline, rejectMergeItem, resolveComment, selectBaselineStale, selectReview } from '../store'
import { anchorLabel, FIELD_LABELS, formatFieldValue } from '../publishing'

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  clean: { color: 'blue', text: '可干净合并' },
  conflict: { color: 'red', text: '冲突 · 需选择' },
  obsolete: { color: 'default', text: '锚点已失效' },
  applied: { color: 'green', text: '已合并' },
}

function MergeTab() {
  const dispatch = useDispatch<AppDispatch>()
  const review = useSelector(selectReview)
  const online = useSelector((state: RootState) => state.score.online)
  const pendingDrafts = useSelector((state: RootState) => state.score.drafts.filter((d) => d.status === 'pending'))
  const actionable = review.filter((item) => item.status !== 'applied')
  const conflictCount = review.filter((item) => item.status === 'conflict').length

  return (
    <div>
      <Alert
        style={{ marginBottom: 16 }}
        type={online ? 'success' : 'warning'}
        showIcon
        icon={online ? <CloudSyncOutlined /> : <CloudOutlined />}
        message={online ? '网络已恢复：出版编辑可逐项合并' : '离线模式：改动保存在各自待合并草稿'}
        description={online
          ? `共有 ${actionable.length} 项改动待合并（其中 ${conflictCount} 项冲突）。合并按音符与评论锚点逐项进行，冲突不会被静默覆盖。`
          : '当前处于离线状态，各编辑的改动仍会进入各自待合并草稿并保存在本地；恢复网络后由出版编辑逐项合并，已合并项不会被重复应用。'}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Card size="small"><Statistic title="待合并改动" value={actionable.length} suffix="项" /></Card>
        <Card size="small"><Statistic title="冲突项" value={conflictCount} suffix="项" valueStyle={{ color: conflictCount ? '#cf1322' : undefined }} /></Card>
        <Card size="small"><Statistic title="待处理草稿" value={pendingDrafts.length} suffix="份" /></Card>
      </Space>
      {actionable.length === 0 && <Empty description="所有改动均已合并，暂无待处理项" />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {review.map((item) => {
          const tag = STATUS_TAG[item.status]!
          const fieldLabel = FIELD_LABELS[item.field] ?? item.field
          return (
            <Card
              key={item.key}
              size="small"
              title={<Space><Tag color={tag.color}>{tag.text}</Tag><b>{anchorLabel(item)}</b><span style={{ color: '#94a3b8', fontWeight: 400 }}>{fieldLabel}</span></Space>}
              extra={item.status === 'clean' && (
                <Space>
                  <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => dispatch(acceptMergeItem({ key: item.key }))}>接受合并</Button>
                  <Button size="small" icon={<CloseOutlined />} onClick={() => dispatch(rejectMergeItem(item.key))}>拒绝</Button>
                </Space>
              )}
            >
              {item.status === 'obsolete' ? (
                <Alert type="warning" showIcon message="该锚点在工作副本中已不存在（音符被删除或评论已移除），无法应用；可拒绝此项或忽略。" style={{ marginBottom: 8 }} />
              ) : (
                <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  <div style={{ color: '#64748b' }}>基线值：<code>{formatFieldValue(item.field, item.base)}</code></div>
                  <div>工作副本（我方）：<code>{formatFieldValue(item.field, item.ours)}</code></div>
                </div>
              )}
              {item.status === 'conflict' && (
                <Alert
                  style={{ marginTop: 8 }}
                  type="error"
                  showIcon
                  icon={<WarningOutlined />}
                  message="同一锚点被多方改为不同值，请选择保留哪一版"
                  description={
                    <Space wrap style={{ marginTop: 8 }}>
                      {item.candidates.map((candidate) => (
                        <Button key={candidate.draftId} size="small" danger type="primary" ghost onClick={() => dispatch(acceptMergeItem({ key: item.key, candidateDraftId: candidate.draftId }))}>
                          采用 {candidate.editorName} · {formatFieldValue(item.field, candidate.value)}
                        </Button>
                      ))}
                      <Button size="small" onClick={() => dispatch(rejectMergeItem(item.key))}>全部拒绝</Button>
                    </Space>
                  }
                />
              )}
              {item.status === 'clean' && item.candidates.map((candidate) => (
                <div key={candidate.draftId} style={{ marginTop: 8, padding: '6px 10px', background: '#f0f7ff', borderRadius: 6, fontSize: 13 }}>
                  <b>{candidate.editorName}</b> · {new Date(candidate.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 改为 <code>{formatFieldValue(item.field, candidate.value)}</code>
                </div>
              ))}
              {item.status === 'applied' && <Tag color="green" style={{ marginTop: 8 }}>已在工作副本中，无需重复合并</Tag>}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default function Versions() {
  const dispatch = useDispatch<AppDispatch>()
  const versions = useSelector((state: RootState) => state.score.versions)
  const comments = useSelector((state: RootState) => state.score.comments)
  const baseline = useSelector((state: RootState) => state.score.baseline)
  const baselineStale = useSelector(selectBaselineStale)
  const review = useSelector(selectReview)
  const pendingCount = useMemo(() => review.filter((item) => item.status !== 'applied').length, [review])
  const invalidatedCount = comments.filter((c) => c.invalidated).length

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">版本、评论与出版基线</p>
          <h1>差异比较与审阅</h1>
          <p>各编辑的改动先进入各自待合并草稿，按音符与评论锚点逐项比较来源与时间；冲突不静默覆盖，合并后旧基线立即失效重算。</p>
        </div>
        <Space>
          <Tooltip title="锁定后，总谱一旦再被改动，基线与基于基线的评论结论立即失效">
            <Button
              type={baselineStale ? 'primary' : 'default'}
              danger={baselineStale}
              icon={<LockOutlined />}
              onClick={() => dispatch(lockBaseline())}
            >
              {baseline ? (baselineStale ? '重新锁定基线' : `已锁定 · ${baseline.label}`) : '锁定出版基线'}
            </Button>
          </Tooltip>
        </Space>
      </div>

      {baselineStale && (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          icon={<ThunderboltOutlined />}
          message="总谱已在基线锁定后发生改动：旧出版基线立即失效"
          description={`${baseline?.label ?? '出版基线'} 已不能反映当前总谱；${invalidatedCount} 条基于旧基线的评论结论已自动回到未解决状态，需在合并完成后重新核对并再次锁定基线。`}
          action={<Button size="small" type="primary" onClick={() => dispatch(lockBaseline())}>重新锁定基线</Button>}
        />
      )}

      <Tabs items={[
        {
          key: 'merge',
          label: <Badge count={pendingCount} offset={[10, -2]} color={pendingCount ? '#cf1322' : '#52c41a'}><span style={{ padding: '0 4px' }}>待合并草稿</span></Badge>,
          children: <MergeTab />,
        },
        {
          key: 'diff',
          label: '版本差异',
          children: <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>{versions.slice(0, 2).map((version) => <Card key={version.id} title={<span>{version.id} · {version.author} <Tag>{version.time}</Tag></span>}><p>{version.summary}</p>{Object.entries(version.trackNotes).map(([trackId, notes]) => <div className="diff-row" key={trackId}><Tag color="red">修改</Tag><span>{trackId}：力度由 mp 调整为 p，增加第 3 拍延音线</span><b>{notes.length} 个音符</b></div>)}<div className="diff-row"><Tag color="green">新增</Tag><span>换页处增加同声部提示音</span><b>2 小节</b></div></Card>)}</div>,
        },
        {
          key: 'comments',
          label: `评论锚点 (${comments.filter((item) => !item.resolved).length})`,
          children: <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .7fr', gap: 16 }}><Card>{comments.map((comment) => <div key={comment.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 12, padding: '14px 0', borderBottom: '1px solid #edf0f5' }}><Tag icon={<CommentOutlined />}>第 {comment.measure} 小节</Tag><div><b>{comment.author}</b>{comment.invalidated && <Tag color="red" style={{ marginLeft: 8 }}>基线失效 · 待重算</Tag>}<p>{comment.content}</p></div><div>{comment.resolved ? <Tag color="green">已解决</Tag> : <Button size="small" onClick={() => dispatch(resolveComment(comment.id))}>应用评论</Button>}</div></div>)}</Card><Card title="待决事项"><Alert type="warning" showIcon message="第 2 小节力度仍未统一" description="接受评论后会更新圆号分谱，但不会静默覆盖其他编辑的待合并改动；冲突项请在「待合并草稿」中逐项选择。" style={{ marginBottom: 12 }} /><Alert type="info" showIcon message="评论结论随基线失效" description="总谱改动后，已解决的评论会自动回到未解决并标记「基线失效 · 待重算」，重新锁定基线后清除标记。" /></Card></div>,
        },
        {
          key: 'timeline',
          label: '操作历史',
          children: <Card><Timeline items={[
            { color: 'green', children: '16:28 沈青提交 v12：调整终段和声与连音线' },
            { color: 'blue', children: '15:40 方亦修改圆号力度，进入各自待合并草稿（离线保存）' },
            { color: 'gray', children: '14:10 发布 v11：单簧管移调分谱' },
          ]} /></Card>,
        },
      ]} />
    </main>
  )
}
