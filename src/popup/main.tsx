import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../global.css';
import './popup.css';

function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [status, setStatus] = useState({ active: false, capture: 'idle', hasVideo: false, subtitle: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { void initialize(); }, []);
  async function initialize() {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true }); setTab(current);
    if (!current.id) return;
    const page = await chrome.tabs.sendMessage(current.id, { type: 'PING' }).catch(() => null);
    const stored = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS', tabId: current.id });
    setStatus({ ...stored, ...page, active: Boolean(stored?.active && page?.active) });
  }
  async function toggle() {
    if (!tab?.id) return; setBusy(true); setMessage('');
    try {
      if (status.active) {
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_LEARNING' });
        await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
        await chrome.runtime.sendMessage({ type: 'SET_TAB_STATUS', tabId: tab.id, status: { active: false, capture: 'idle' } });
        setStatus(s => ({ ...s, active: false, capture: 'idle' }));
      } else {
        const page = await chrome.tabs.sendMessage(tab.id, { type: 'START_LEARNING' });
        if (!page?.ok) throw new Error(page?.error || '无法启动页面学习模式');
        const capture = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId: tab.id });
        const captureState = capture?.ok ? 'active' : 'failed';
        await chrome.runtime.sendMessage({ type: 'SET_TAB_STATUS', tabId: tab.id, status: { active: true, capture: captureState } });
        setStatus(s => ({ ...s, active: true, capture: captureState }));
        if (!capture?.ok) setMessage('学习模式已启动；当前网页音频无法捕获，将使用在线回放。');
      }
    } catch (error) { setMessage(String((error as Error).message || error)); }
    setBusy(false);
  }
  return <main className="popup">
    <header><div className="brand"><div className="logo">C</div><div>ClipLingo<small>视频语句学习</small></div></div><button className="icon" onClick={() => chrome.runtime.openOptionsPage()}>⚙</button></header>
    <section className="video card"><div className="statusRow"><span className={`dot ${status.hasVideo ? 'ok' : ''}`} /><div><b>{status.hasVideo ? '已检测到视频' : '未检测到视频'}</b><p>{tab?.title || '当前页面'}</p></div></div>
      <div className="meters"><span>字幕 <b>{status.subtitle ? '已识别' : '等待中'}</b></span><span>原声 <b>{status.capture === 'active' ? '捕获中' : status.capture === 'failed' ? '在线回放' : '未启动'}</b></span></div>
    </section>
    <button className={`start ${status.active ? 'stop' : ''}`} disabled={busy || !status.hasVideo} onClick={toggle}>{busy ? '正在处理…' : status.active ? '停止学习' : '开始学习'}</button>
    {message && <p className="notice">{message}</p>}
    <nav><button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/library/index.html') })}>▤<span>语句库</span></button><button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') })}>⌁<span>API 设置</span></button></nav>
    <footer><span><kbd>Alt S</kbd> 收藏</span><span><kbd>Alt R</kbd> 循环</span><span><kbd>Alt H</kbd> 隐藏</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
