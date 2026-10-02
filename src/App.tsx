import { Layout, Menu, Tag, Space, Segmented, Badge, Alert, Button, Modal } from 'antd'
import { AudioOutlined, FileTextOutlined, HistoryOutlined, MergeCellsOutlined, WifiOutlined, DisconnectOutlined } from '@ant-design/icons'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './store'
import { dismissRecoveryReport, setActiveEditor, setOnline } from './store'
import { buildMergeQueue, fullTimeText } from './merge/engine'
import { describeJournalEntries } from './merge/storage'
import { editors } from './mock'
import Overview from './pages/Overview'
import ScoreEditor from './pages/ScoreEditor'
import Parts from './pages/Parts'
import Versions from './pages/Versions'
import MergeConsole from './pages/MergeConsole'

export default function App() {
  const location = useLocation()
  const dispatch = useDispatch<AppDispatch>()
  const { activeEditor, online, dirty, drafts, canonicalTracks, comments, decisions, baseline, recoveryReport } = useSelector((state: RootState) => state.score)
  const queue = buildMergeQueue(drafts, canonicalTracks, comments, decisions)
  const conflicts = queue.filter((item) => item.status === 'conflict' || item.status === 'blocked').length
  const pending = queue.filter((item) => !item.decided).length
  const items = [
    { key: '/', icon: <AudioOutlined />, label: <Link to="/">作品总览</Link> },
    { key: '/score', icon: <FileTextOutlined />, label: <Link to="/score">总谱编辑（草稿）</Link> },
    { key: '/parts', icon: <FileTextOutlined />, label: <Link to="/parts">分谱出版</Link> },
    { key: '/merge', icon: <MergeCellsOutlined />, label: <Badge size="small" count={conflicts || pending} offset={[6, -2]}><Link to="/merge">离线合并台</Link></Badge> },
    { key: '/versions', icon: <HistoryOutlined />, label: <Link to="/versions">版本与评论</Link> },
  ]
  return (
    <Layout className="app-shell">
      <Layout.Sider width={224} style={{ background: '#0f172a', color: '#fff', minHeight: '100vh' }}>
        <div className="brand"><span className="brand-mark">谱</span><div><b>总谱出版台</b><small>SCORE PUBLISHING</small></div></div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={items} style={{ background: 'transparent', border: 0 }} />
        <div className="side-status">
          <b>《潮汐线》</b><small>总谱 12 小节 · 分谱 4 册</small>
          <div style={{ marginTop: 10 }}>
            {baseline ? <Tag color={baseline.status === 'valid' ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>{baseline.status === 'valid' ? '基线有效' : '基线已失效'}</Tag> : <Tag>无基线</Tag>}
          </div>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="top-header">
          <div>
            <b>沈青 · 室内交响作品</b>
            <Tag style={{ marginLeft: 10 }} color={dirty ? 'orange' : 'green'}>{dirty ? '草稿已离线保存（待合并）' : '与合并基线一致'}</Tag>
            <Tag icon={online ? <WifiOutlined /> : <DisconnectOutlined />} color={online ? 'blue' : 'default'}>{online ? '网络已恢复' : '排练离线中'}</Tag>
          </div>
          <Space>
            <Segmented
              size="small"
              value={online ? 'online' : 'offline'}
              options={[{ label: '离线', value: 'offline', icon: <DisconnectOutlined /> }, { label: '在线', value: 'online', icon: <WifiOutlined /> }]}
              onChange={(value) => dispatch(setOnline(value === 'online'))}
            />
            <Segmented
              size="small"
              value={activeEditor}
              options={editors.map((editor) => ({ label: `${editor.role} · ${editor.name}`, value: editor.id }))}
              onChange={(value) => dispatch(setActiveEditor(value as typeof activeEditor))}
            />
          </Space>
        </Layout.Header>
        {recoveryReport && (
          <Alert
            className="recovery-banner"
            type={recoveryReport.reason === 'legacy-upgrade' ? 'info' : 'warning'}
            showIcon
            banner
            message={
              recoveryReport.reason === 'legacy-upgrade'
                ? `旧稿升级完成：保留 ${recoveryReport.legacy?.preservedNotes ?? 0} 个原音符、${recoveryReport.legacy?.preservedComments ?? 0} 条原评论，已进入「${recoveryReport.legacy?.draftEditor}」待合并草稿`
                : '草稿读取失败，已恢复最近完整草稿'
            }
            description={
              <div>
                <div>{recoveryReport.message}</div>
                {recoveryReport.usedSavedAt && <div className="muted">恢复点保存于 {fullTimeText(recoveryReport.usedSavedAt)}{recoveryReport.brokenSavedAt ? `；损坏的自动保存时间为 ${fullTimeText(recoveryReport.brokenSavedAt)}` : ''}</div>}
                {recoveryReport.lostOperations.length > 0 && (
                  <details>
                    <summary>丢失范围（{recoveryReport.lostOperations.length} 笔操作，晚于恢复点，需重做）</summary>
                    <pre className="loss-pre">{describeJournalEntries(recoveryReport.lostOperations)}</pre>
                  </details>
                )}
              </div>
            }
            action={<Button size="small" onClick={() => dispatch(dismissRecoveryReport())}>知道了</Button>}
          />
        )}
        <Layout.Content><Routes><Route path="/" element={<Overview />} /><Route path="/score" element={<ScoreEditor />} /><Route path="/parts" element={<Parts />} /><Route path="/merge" element={<MergeConsole />} /><Route path="/versions" element={<Versions />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Layout.Content>
      </Layout>
    </Layout>
  )
}
