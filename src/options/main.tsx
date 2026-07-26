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
  async function testAi() { setTesting(true); await saveSettings(settings); const result = await chrome.runtime.sendMessage({ type: 'AI_EXPLAIN', text: 'Learning from context is powerful.' }); setSaved(result?.ok ? 'MiniMax-M3 连接成功' : `连接失败：${result?.error}`); setTesting(false); }
  async function testSpeech() {
    setTesting(true); await saveSettings(settings);
    const result = await chrome.runtime.sendMessage({ type: 'MINIMAX_TTS', text: 'Welcome to ClipLingo. Let us practice this sentence together.' });
    if (result?.ok) { await new Audio(result.audio).play(); setSaved('Speech 2.8 连接成功，正在播放试听'); }
    else setSaved(`语音连接失败：${result?.error}`);
    setTesting(false);
  }
  return <div className="page"><header className="topbar"><div className="brand"><div className="logo">C</div>ClipLingo 设置</div><button className="primary" onClick={store}>保存设置</button></header>
    <main className="settings"><aside><a href="#ai">MiniMax API</a><a href="#speech">AI 示范音</a><a href="#coach">跟读与教练</a><a href="#translation">翻译</a><a href="#subtitle">字幕外观</a><a href="#privacy">隐私与权限</a></aside><div className="forms">
      <section id="ai" className="card"><h2>MiniMax API</h2><p className="muted">同一个 Key 用于 Speech 2.8、MiniMax-M3、查词和讲解，只保存在浏览器本地。</p><div className="grid"><Field label="API Base URL"><input value={settings.apiBaseUrl} onChange={e=>update('apiBaseUrl',e.target.value)} /></Field><Field label="口语教练模型"><input value={settings.model} onChange={e=>update('model',e.target.value)} /></Field></div><Field label="MiniMax API Key"><input type="password" placeholder="填写开放平台 API Key" value={settings.apiKey} onChange={e=>update('apiKey',e.target.value)} /></Field><button className="ghost" onClick={testAi} disabled={testing}>{testing?'正在测试…':'测试 M3 连接'}</button></section>
      <section id="speech" className="card"><h2>AI 示范音</h2><p className="muted">默认使用低延迟的 Speech 2.8 Turbo。也可以填写你在 MiniMax 创建的人物复刻 Voice ID。</p><div className="grid"><Field label="语音模型"><select value={settings.speechModel} onChange={e=>update('speechModel',e.target.value)}><option value="speech-2.8-turbo">speech-2.8-turbo（推荐）</option><option value="speech-2.8-hd">speech-2.8-hd（高质量）</option></select></Field><Field label="Voice ID"><input value={settings.speechVoiceId} onChange={e=>update('speechVoiceId',e.target.value)} /></Field><Field label={`示范语速：${settings.speechSpeed.toFixed(2)}×`}><input type="range" min=".5" max="1.5" step=".05" value={settings.speechSpeed} onChange={e=>update('speechSpeed',Number(e.target.value))}/></Field><Field label="默认情绪"><select value={settings.speechEmotion} onChange={e=>update('speechEmotion',e.target.value)}><option value="neutral">自然</option><option value="happy">开心</option><option value="sad">悲伤</option><option value="angry">生气</option><option value="fearful">紧张</option><option value="surprised">惊讶</option></select></Field></div><button className="ghost" onClick={testSpeech} disabled={testing}>{testing?'正在生成…':'生成试听'}</button></section>
      <section id="coach" className="card"><h2>跟读与口语教练</h2><p className="muted">Chrome 在本地完成语音转写；插件在本地计算准确度、完整度、语速、停顿、音高和能量变化，再把文字与分数交给 MiniMax-M3。</p><label className="check"><input type="checkbox" checked={settings.autoCoach} onChange={e=>update('autoCoach',e.target.checked)}/> 每次跟读评分后自动生成中文教练反馈</label></section>
      <section id="translation" className="card"><h2>字幕翻译</h2><Field label="翻译方式"><select value={settings.translationMode} onChange={e=>update('translationMode',e.target.value as Settings['translationMode'])}><option value="chrome-fallback-minimax">Chrome 本地翻译，失败时 MiniMax（推荐）</option><option value="minimax">始终使用 MiniMax</option><option value="off">关闭翻译</option></select></Field><Field label="MiniMax 翻译提示词"><textarea rows={4} value={settings.translationPrompt} onChange={e=>update('translationPrompt',e.target.value)} /></Field></section>
      <section id="subtitle" className="card"><h2>字幕与播放</h2><div className="grid"><Field label={`字幕字号：${settings.fontSize}px`}><input type="range" min="15" max="34" value={settings.fontSize} onChange={e=>update('fontSize',Number(e.target.value))}/></Field><Field label={`背景透明度：${settings.opacity}%`}><input type="range" min="45" max="95" value={settings.opacity} onChange={e=>update('opacity',Number(e.target.value))}/></Field><Field label="默认循环次数"><select value={settings.loopCount} onChange={e=>update('loopCount',Number(e.target.value))}><option value="0">无限</option><option value="1">1 次</option><option value="3">3 次</option><option value="5">5 次</option></select></Field><Field label="默认播放速度"><select value={settings.playbackRate} onChange={e=>update('playbackRate',Number(e.target.value))}><option>.5</option><option>.75</option><option>1</option><option>1.25</option></select></Field></div></section>
      <section id="privacy" className="card"><h2>隐私与权限</h2><p>收藏语句、音频和 API 配置保存在浏览器本地。生成示范音时台词会发送给 MiniMax；生成口语教练反馈时会发送目标台词、Chrome 识别文本和本地评分。</p><p className="muted">麦克风只在你点击“跟读”后启用，录音不保存也不上传 MiniMax。标签页音频仅在主动开启学习模式后捕获。</p></section>{saved&&<div className="toast">{saved}</div>}
    </div></main></div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="field"><label>{label}</label>{children}</div>}
createRoot(document.getElementById('root')!).render(<App/>);
