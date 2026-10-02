import { useEffect } from 'react'
import { Layout, Menu, Button, Tag, Space, Select, Alert } from 'antd'
import { AudioOutlined, CloudOutlined, FileTextOutlined, HistoryOutlined, SaveOutlined, WifiOutlined } from '@ant-design/icons'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './store'
import { dismissNotice, saveVersion, selectBaselineStale, setCurrentEditor, setOnline } from './store'
import Overview from './pages/Overview'
import ScoreEditor from './pages/ScoreEditor'
import Parts from './pages/Parts'
import Versions from './pages/Versions'

export default function App() {
  const location = useLocation()
  const dispatch = useDispatch<AppDispatch>()
  const dirty = useSelector((state: RootState) => state.score.dirty)
  const online = useSelector((state: RootState) => state.score.online)
  const baseline = useSelector((state: RootState) => state.score.baseline)
  const baselineStale = useSelector(selectBaselineStale)
  const editors = useSelector((state: RootState) => state.score.editors)
  const currentEditorId = useSelector((state: RootState) => state.score.currentEditorId)
  const notices = useSelector((state: RootState) => state.score.recoveryNotices)
  const items = [
    { key: '/', icon: <AudioOutlined />, label: <Link to="/">作品总览</Link> },
    { key: '/score', icon: <FileTextOutlined />, label: <Link to="/score">总谱编辑</Link> },
    { key: '/parts', icon: <FileTextOutlined />, label: <Link to="/parts">分谱出版</Link> },
    { key: '/versions', icon: <HistoryOutlined />, label: <Link to="/versions">版本与评论</Link> },
  ]

  useEffect(() => {
    const onOnline = () => dispatch(setOnline(true))
    const onOffline = () => dispatch(setOnline(false))
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [dispatch])

  return (
    <Layout className="app-shell">
      <Layout.Sider width={224} style={{ background: '#0f172a', color: '#fff', minHeight: '100vh' }}>
        <div className="brand"><span className="brand-mark">谱</span><div><b>总谱出版台</b><small>SCORE PUBLISHING</small></div></div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={items} style={{ background: 'transparent', border: 0 }} />
        <div className="side-status"><b>《潮汐线》</b><small>总谱 12 小节 · 分谱 4 册</small></div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="top-header">
          <div>
            <b>沈青 · 室内交响作品</b>
            <Tag style={{ marginLeft: 10 }} color={dirty ? 'orange' : 'green'}>{dirty ? '当前草稿有未合并改动' : '工作副本已保存'}</Tag>
            <Tag color={online ? 'green' : 'red'} icon={online ? <WifiOutlined /> : <CloudOutlined />}>{online ? '在线 · 可逐项合并' : '离线 · 改动入草稿'}</Tag>
            {baseline && <Tag color={baselineStale ? 'red' : 'blue'}>{baselineStale ? '基线已失效 · 待重算' : baseline.label}</Tag>}
          </div>
          <Space>
            <Select
              value={currentEditorId}
              style={{ width: 170 }}
              onChange={(value) => dispatch(setCurrentEditor(value))}
              options={editors.map((editor) => ({ value: editor.id, label: `${editor.name} · ${editor.role}` }))}
            />
            <Button>打印预览</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => dispatch(saveVersion())}>形成版本</Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: '16px 22px 0' }}>
          {notices.map((notice) => (
            <Alert
              key={notice.id}
              style={{ marginBottom: 12 }}
              type={notice.type === 'recovery' ? 'error' : 'success'}
              showIcon
              closable
              onClose={() => dispatch(dismissNotice(notice.id))}
              message={notice.title}
              description={
                <div>
                  <p style={{ margin: 0 }}>{notice.description}</p>
                  {notice.preservedNotes !== undefined && <p style={{ margin: '4px 0 0' }}>保留范围：{notice.preservedNotes} 个音符、{notice.preservedComments} 条评论。</p>}
                  {notice.lostItems && notice.lostItems.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {notice.lostItems.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  )}
                </div>
              }
            />
          ))}
        </Layout.Content>
        <Layout.Content><Routes><Route path="/" element={<Overview />} /><Route path="/score" element={<ScoreEditor />} /><Route path="/parts" element={<Parts />} /><Route path="/versions" element={<Versions />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Layout.Content>
      </Layout>
    </Layout>
  )
}
