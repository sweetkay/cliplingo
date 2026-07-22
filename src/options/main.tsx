import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSettings, saveSettings } from '../shared/settings';
import { defaultSettings, type Settings } from '../shared/types';
import '../global.css'; import './options.css';

function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings); const [saved, setSaved] = useState(''); const [testing, setTesting] = useState(false);
  useEffect(() => { void loadSettings().then(setSettings); }, []);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => ({ ...s, [key]: value }));
  async function store() { await saveSettings(settings); setSaved('设置已保存在本地'); setTimeout(() => setSaved(''), 2000); }
  async function test() { setTesting(true); await saveSettings(settings); const result = await chrome.runtime.sendMessage({ type: 'AI_TRANSLATE', texts: ['Learning from context is powerful.'] }); setSaved(result?.ok ? `连接成功：${result.content}` : `连接失败：${result?.error}`); setTesting(false); }
  return <div className="page"><header className="topbar"><div className="brand"><div className="logo">C</div>ClipLingo 设置</div><button className="primary" onClick={store}>保存设置</button></header>
    <main className="settings"><aside><a href="#ai">大模型 API</a><a href="#speech">语音识别</a><a href="#subtitle">字幕外观</a><a href="#privacy">隐私与权限</a></aside><div className="forms">
      <section id="ai" className="card"><h2>大模型 API</h2><p className="muted">支持 OpenAI-compatible Chat Completions 接口。Key 仅保存在浏览器本地。</p><div className="grid"><Field label="API Base URL"><input value={settings.apiBaseUrl} onChange={e=>update('apiBaseUrl',e.target.value)} /></Field><Field label="模型名称"><input value={settings.model} onChange={e=>update('model',e.target.value)} /></Field></div><Field label="API Key"><input type="password" placeholder="sk-…" value={settings.apiKey} onChange={e=>update('apiKey',e.target.value)} /></Field><Field label="翻译提示词"><textarea rows={4} value={settings.translationPrompt} onChange={e=>update('translationPrompt',e.target.value)} /></Field><button className="ghost" onClick={test} disabled={testing}>{testing?'正在测试…':'测试连接'}</button></section>
      <section id="speech" className="card"><h2>语音识别</h2><p className="muted">跟读默认使用 Chrome 语音识别。以下接口为后续兼容语音转写服务预留。</p><div className="grid"><Field label="转写 Base URL"><input value={settings.transcriptionBaseUrl} onChange={e=>update('transcriptionBaseUrl',e.target.value)} /></Field><Field label="转写模型"><input value={settings.transcriptionModel} onChange={e=>update('transcriptionModel',e.target.value)} /></Field></div><Field label="转写 API Key"><input type="password" value={settings.transcriptionApiKey} onChange={e=>update('transcriptionApiKey',e.target.value)} /></Field></section>
      <section id="subtitle" className="card"><h2>字幕与播放</h2><div className="grid"><Field label={`字幕字号：${settings.fontSize}px`}><input type="range" min="15" max="34" value={settings.fontSize} onChange={e=>update('fontSize',Number(e.target.value))}/></Field><Field label={`背景透明度：${settings.opacity}%`}><input type="range" min="45" max="95" value={settings.opacity} onChange={e=>update('opacity',Number(e.target.value))}/></Field><Field label="默认循环次数"><select value={settings.loopCount} onChange={e=>update('loopCount',Number(e.target.value))}><option value="0">无限</option><option value="1">1 次</option><option value="3">3 次</option><option value="5">5 次</option></select></Field><Field label="默认播放速度"><select value={settings.playbackRate} onChange={e=>update('playbackRate',Number(e.target.value))}><option>.5</option><option>.75</option><option>1</option><option>1.25</option></select></Field></div></section>
      <section id="privacy" className="card"><h2>隐私与权限</h2><p>收藏语句、音频和 API 配置保存在浏览器本地。只有在请求翻译、查词或讲解时，相关文本才会发送到你配置的 API。</p><p className="muted">标签页音频仅在主动开启学习模式后捕获。插件不会上传完整视频，也不会在后台自动录音。</p></section>{saved&&<div className="toast">{saved}</div>}
    </div></main></div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="field"><label>{label}</label>{children}</div>}
createRoot(document.getElementById('root')!).render(<App/>);
