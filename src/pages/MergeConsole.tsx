import { useMemo } from 'react'
import { Alert, Button, Card, Col, Empty, Popconfirm, Radio, Row, Space, Statistic, Table, Tabs, Tag, Timeline, Tooltip } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, LockOutlined, MergeCellsOutlined, SafetyCertificateOutlined, WarningOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { applyMerges, confirmCommentRecheck, dismissRecoveryReport, lockBaseline, setDecision, simulateAndReload } from '../store'
import { buildMergeQueue, formatValue, fullTimeText, timeText, type MergeItem } from '../merge/engine'
import { LEGACY_KEY } from '../merge/storage'

const editorText: Record<string, string> = { conductor: '指挥 · 方亦', composer: '作曲 · 沈青', publisher: '出版 · 赵晴' }

export default function MergeConsole() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.score)
  const { drafts, canonicalTracks, comments, decisions, baseline, online, activeEditor, mergeLog, recoveryReport } = state
  const queue = useMemo(() => buildMergeQueue(drafts, canonicalTracks, comments, decisions), [drafts, canonicalTracks, comments, decisions])

  const conflictCount = queue.filter((item) => item.status === 'conflict').length
  const blockedCount = queue.filter((item) => item.status === 'blocked').length
  const cleanCount = queue.filter((item) => item.status === 'clean').length
  const decidedCount = queue.filter((item) => item.decided).length
  const isPublisherOnline = activeEditor === 'publisher' && online
  const canApply = decidedCount > 0 && isPublisherOnline

  const seedLegacy = () => {
    // 直接写入一份 v1 旧稿（旧结构：单键、无锚点元数据），便于演练升级
    const tracks = structuredClone(canonicalTracks)
    tracks[0]!.notes[0] = { ...tracks[0]!.notes[0]!, dynamic: 'f', expression: 'risoluto' }
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ tracks, comments }))
  }

  return <main className="page">
    <div className="page-head">
      <div>
        <p className="eyebrow">离线出版合并流程</p>
        <h1>离线合并台</h1>
        <p>每位编辑的改动先进入各自待合并草稿；此处按音符与评论锚点比较来源与时间，冲突必须显式选边，绝不静默覆盖。</p>
      </div>
      <Space>
        <Tooltip title="先切换到「出版编辑」并在右上角恢复网络后才能执行合并"><Tag color={isPublisherOnline ? 'green' : 'default'}>{online ? (activeEditor === 'publisher' ? '出版编辑在线 · 可合并' : '仅出版编辑可合并') : '离线 · 可逐项预判，联网后提交'}</Tag></Tooltip>
        <Button type="primary" icon={<MergeCellsOutlined />} disabled={!canApply} onClick={() => dispatch(applyMerges())}>
          逐项合并已决定项（{decidedCount}）
        </Button>
      </Space>
    </div>

    {!online && <Alert type="info" showIcon style={{ marginBottom: 14 }} message="排练离线中：决定会随草稿保存在本机；网络恢复、出版编辑到场后一次性提交合并，未决定的冲突会保留。" />}
    {online && activeEditor !== 'publisher' && <Alert type="warning" showIcon style={{ marginBottom: 14 }} message="网络已恢复，但逐项合并只能由出版编辑执行；右上角切换到「出版 · 赵晴」。" />}

    <Row gutter={[12, 12]} className="metrics" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
      <Col><Card><Statistic title="冲突锚点（必须选边）" value={conflictCount} valueStyle={{ color: '#dc2626' }} prefix={<WarningOutlined />} /></Card></Col>
      <Col><Card><Statistic title="阻塞锚点（实体缺失）" value={blockedCount} valueStyle={{ color: '#d97706' }} /></Card></Col>
      <Col><Card><Statistic title="单方待合并" value={cleanCount} valueStyle={{ color: '#2563eb' }} /></Card></Col>
      <Col><Card><Statistic title="已逐项决定" value={decidedCount} suffix={`/ ${queue.length}`} valueStyle={{ color: '#059669' }} /></Card></Col>
    </Row>

    <Tabs items={[
      { key: 'queue', label: `逐项合并 (${queue.length})`, children: <QueueTable queue={queue} onDecide={(changeId, decision) => dispatch(setDecision({ changeId, decision }))} disabled={!isPublisherOnline} /> },
      { key: 'drafts', label: `待合并草稿 (${drafts.length})`, children: <DraftCards /> },
      { key: 'baseline', label: '出版基线与复核', children: <BaselinePanel onRecheck={(id) => dispatch(confirmCommentRecheck(id))} onLock={() => dispatch(lockBaseline())} canLock={isPublisherOnline} /> },
      { key: 'recovery', label: '离线存储与恢复', children: <RecoveryPanel onLatest={() => dispatch(simulateAndReload('latest'))} onAll={() => dispatch(simulateAndReload('all'))} onLegacy={() => { seedLegacy(); location.reload() }} report={recoveryReport} onDismiss={() => dispatch(dismissRecoveryReport())} /> },
      { key: 'log', label: `合并记录 (${mergeLog.length})`, children: <MergeLog /> },
    ]} />
  </main>
}

function QueueTable({ queue, onDecide, disabled }: { queue: MergeItem[]; onDecide: (changeId: string, decision: 'accepted' | 'rejected' | null) => void; disabled: boolean }) {
  if (!queue.length) return <Empty description="没有待合并改动：所有草稿均与总谱基线一致" />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {queue.map((item) => {
        const statusTag = item.status === 'conflict'
          ? <Tag color="red" icon={<WarningOutlined />}>冲突 · 禁止静默覆盖</Tag>
          : item.status === 'blocked'
            ? <Tag color="orange">阻塞 · 锚点不在总谱</Tag>
            : <Tag color="blue">单方改动</Tag>
        const acceptedId = item.changes.find((change) => change.decision === 'accepted')?.id
        return (
          <Card key={item.id} size="small" className={item.status === 'conflict' ? 'merge-item conflict' : item.status === 'blocked' ? 'merge-item blocked' : 'merge-item'}>
            <div className="merge-item-head">
              <Space wrap>
                {statusTag}
                <b>{item.label}</b>
                <Tag>{item.kind === 'note' ? '音符锚点' : item.kind === 'comment' ? '评论锚点' : '声部锚点'} · {item.fieldLabel}</Tag>
                {item.decided && <Tag color={item.accepted ? 'green' : 'default'}>{item.accepted ? '已选择接受' : '已选择拒绝'}</Tag>}
              </Space>
              <Space>
                <Button size="small" disabled={disabled} danger={!item.accepted} icon={<CloseCircleOutlined />} onClick={() => item.changes.filter((change) => change.source !== 'merged').forEach((change) => onDecide(change.id, 'rejected'))}>全部拒绝</Button>
              </Space>
            </div>
            {item.reasons.length > 0 && <ul className="merge-reasons">{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            <Radio.Group
              className="merge-choices"
              value={acceptedId ?? (item.changes.every((change) => change.decision === 'rejected') ? '__reject__' : undefined)}
              onChange={(event) => {
                const id = event.target.value as string
                item.changes.forEach((change) => {
                  if (change.source === 'merged') return // 已合并结果是参照项，不占决定
                  onDecide(change.id, id === '__reject__' ? 'rejected' : id === change.id ? 'accepted' : 'rejected')
                })
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {item.changes.map((change, index) => (
                  <Radio key={change.id} value={change.id} disabled={disabled || (item.status === 'blocked' && change.source !== 'merged')} className={change.source === 'merged' ? 'choice-merged' : ''}>
                    <Space wrap size={[8, 4]}>
                      <Tag color={change.source === 'merged' ? 'geekblue' : undefined}>{editorText[change.editorId] ?? change.editorId}{change.source === 'merged' ? ' · 已合并结果' : ''}</Tag>
                      <span className="muted">{fullTimeText(change.time)}</span>
                      <span><s className="muted">{formatValue(change.oldValue)}</s> → <b>{formatValue(change.newValue)}</b></span>
                      {index === 0 && change.source !== 'merged' && <Tag color="gold">最新来源时间</Tag>}
                    </Space>
                  </Radio>
                ))}
                <Radio value="__reject__" disabled={disabled}>拒绝该锚点全部改动（保持总谱现状）</Radio>
              </Space>
            </Radio.Group>
          </Card>
        )
      })}
    </div>
  )
}

function DraftCards() {
  const { drafts, canonicalTracks, comments, decisions } = useSelector((state: RootState) => state.score)
  const queue = useMemo(() => buildMergeQueue(drafts, canonicalTracks, comments, decisions), [drafts, canonicalTracks, comments, decisions])
  return (
    <Row gutter={[14, 14]}>
      {drafts.map((draft) => {
        const changes = queue.filter((item) => item.changes.some((change) => change.draftId === draft.id))
        const conflicts = changes.filter((item) => item.status === 'conflict').length
        return (
          <Col xs={24} md={12} xl={8} key={draft.id}>
            <Card title={<Space><b>{draft.role} · {draft.editorName}</b>{conflicts ? <Tag color="red">涉冲突 {conflicts}</Tag> : changes.length ? <Tag color="orange">待合并 {changes.length}</Tag> : <Tag color="green">已同步</Tag>}</Space>} extra={<small className="muted">{fullTimeText(draft.updatedAt)}</small>}>
              <p className="muted" style={{ marginBottom: 8 }}>改动先留在此草稿，与他人隔离；操作流水随离线检查点保存。</p>
              {changes.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="草稿无偏离" /> : (
                <ul className="draft-change-list">
                  {changes.slice(0, 10).map((item) => (
                    <li key={item.id}>
                      {item.status === 'conflict' ? <Tag color="red">冲突</Tag> : <Tag color="blue">待合并</Tag>}
                      {item.label} · {item.fieldLabel}
                    </li>
                  ))}
                  {changes.length > 10 && <li className="muted">…其余 {changes.length - 10} 项见「逐项合并」</li>}
                </ul>
              )}
              <div className="muted" style={{ marginTop: 8 }}>流水 {draft.journal.length} 笔 · rebase 冲突 {draft.rebaseConflicts.length / 2} 组</div>
            </Card>
          </Col>
        )
      })}
    </Row>
  )
}

function BaselinePanel({ onRecheck, onLock, canLock }: { onRecheck: (id: string) => void; onLock: () => void; canLock: boolean }) {
  const { baseline, comments } = useSelector((state: RootState) => state.score)
  const recheckComments = comments.filter((comment) => comment.needsRecheck)
  return (
    <Row gutter={[14, 14]}>
      <Col xs={24} xl={15}>
        <Card
          title={<Space><SafetyCertificateOutlined /> 出版基线</Space>}
          extra={baseline ? <Tag color={baseline.status === 'valid' ? 'green' : 'red'}>{baseline.status === 'valid' ? '有效' : '已失效'}</Tag> : null}
        >
          {!baseline && <Empty description="尚未锁定出版基线" />}
          {baseline && (
            <>
              <p><b>{baseline.title}</b> · {baseline.lockedBy} 于 {fullTimeText(baseline.lockedAt)} 锁定</p>
              {baseline.status === 'invalid' && (
                <Alert
                  type="error" showIcon style={{ marginBottom: 12 }}
                  message="总谱接受合并后，旧基线立即失效，以下锚点已偏离并触发重算"
                  description={`失效时间 ${fullTimeText(baseline.invalidatedAt ?? 0)}；共 ${baseline.staleAnchors.length} 处，相关小节的评论处理结论已被置为「待复核」。`}
                />
              )}
              <Table
                rowKey={(row) => `${row.anchor.kind}-${row.anchor.trackId ?? ''}-${row.anchor.noteId ?? row.anchor.commentId ?? ''}-${row.label}`}
                size="small" pagination={{ pageSize: 8 }}
                dataSource={baseline.staleAnchors}
                columns={[
                  { title: '锚点', dataIndex: 'label' },
                  { title: '变化', dataIndex: 'detail' },
                  { title: '类型', render: (_, row) => row.anchor.kind === 'note' ? '音符' : row.anchor.kind === 'comment' ? '评论' : '声部移调' },
                ]}
              />
              <Popconfirm title="以当前已合并总谱重锁出版基线？" description="重算全部锚点指纹，刷新分谱版本号。" onConfirm={onLock} disabled={!canLock}>
                <Tooltip title={canLock ? '' : '需出版编辑在线'}><Button type="primary" icon={<LockOutlined />} disabled={!canLock} style={{ marginTop: 12 }}>按当前总谱重锁基线</Button></Tooltip>
              </Popconfirm>
            </>
          )}
        </Card>
      </Col>
      <Col xs={24} xl={9}>
        <Card title={`结论失效待复核 (${recheckComments.length})`}>
          {recheckComments.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有因合并失效的评论结论" /> : (
            recheckComments.map((comment) => (
              <div key={comment.id} className="recheck-row">
                <Tag color="red">第 {comment.measure} 小节</Tag>
                <div><b>{comment.author}</b><p>{comment.content}</p><small className="muted">原结论随基线 {comment.resolvedBaselineId} 失效，需出版编辑重新确认</small></div>
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} disabled={!canLock} onClick={() => onRecheck(comment.id)}>复核通过</Button>
              </div>
            ))
          )}
        </Card>
      </Col>
    </Row>
  )
}

function RecoveryPanel({ onLatest, onAll, onLegacy, report, onDismiss }: { onLatest: () => void; onAll: () => void; onLegacy: () => void; report: RootState['score']['recoveryReport']; onDismiss: () => void }) {
  return (
    <Row gutter={[14, 14]}>
      <Col xs={24} xl={14}>
        <Card title="三代检查点 + 操作流水">
          <p className="muted">每次编辑都原子写入新一代完整检查点（写新槽成功后才切换指针，不会只剩半截）；指针中保留各检查点的操作流水摘要，回滚时可逐笔列出丢失范围。</p>
          <Space wrap>
            <Button danger onClick={onLatest}>模拟最新自动保存损坏并刷新</Button>
            <Button danger onClick={onAll}>模拟三份检查点全损坏并刷新</Button>
            <Button onClick={onLegacy}>写入并加载 v1 旧稿（升级演练）</Button>
          </Space>
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card title="恢复结果">
          {!report ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前未发生读取失败或升级" /> : (
            <Alert
              type={report.reason === 'legacy-upgrade' ? 'info' : 'warning'} showIcon
              message={report.reason === 'legacy-upgrade' ? '旧稿已升级' : '已恢复最近完整草稿'}
              description={
                <div>
                  <p style={{ marginBottom: 6 }}>{report.message}</p>
                  {report.usedSavedAt && <p className="muted">恢复点：{fullTimeText(report.usedSavedAt)}{report.brokenSavedAt ? ` · 损坏点：${fullTimeText(report.brokenSavedAt)}` : ''}</p>}
                  {report.lostOperations.length > 0 && (
                    <details open>
                      <summary>丢失范围（{report.lostOperations.length} 笔）</summary>
                      <ul className="loss-list">{report.lostOperations.map((entry) => <li key={`${entry.editorId}-${entry.seq}`}>{timeText(entry.time)} {entry.label}（{entry.anchorText}）</li>)}</ul>
                    </details>
                  )}
                  {report.legacy && <p className="muted">保留原音符 {report.legacy.preservedNotes} 个、原评论 {report.legacy.preservedComments} 条，进入「{report.legacy.draftEditor}」待合并。</p>}
                  <Button size="small" style={{ marginTop: 8 }} onClick={onDismiss}>关闭说明</Button>
                </div>
              }
            />
          )}
        </Card>
      </Col>
    </Row>
  )
}

function MergeLog() {
  const { mergeLog } = useSelector((state: RootState) => state.score)
  if (!mergeLog.length) return <Empty description="尚无合并记录" />
  return <Card><Timeline items={mergeLog.map((entry) => ({
    color: entry.baselineInvalidated ? 'red' : 'green',
    children: <div>
      <b>{fullTimeText(entry.time)}</b> {entry.note}
      <div className="muted">受影响声部：{entry.affectedTracks.length ? entry.affectedTracks.join('、') : '无'}；小节：{entry.affectedMeasures.length ? entry.affectedMeasures.map((measure) => `第 ${measure} 小节`).join('、') : '无'}</div>
    </div>,
  }))} /></Card>
}
