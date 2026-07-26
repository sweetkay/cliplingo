import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { deleteSentence, exportLibrary, getSentences, importLibrary, updateSentence } from '../shared/db';
import { scoreSpeech } from '../shared/scoring';
import { loadSettings } from '../shared/settings';
import type { Sentence, SpeechMetrics } from '../shared/types';
import '../global.css';
import './library.css';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechWindow = Window & typeof globalThis & {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
};

type TtsAsset = { source: string; duration: number };
const ttsCache = new Map<string, TtsAsset>();

function App() {
  const [rows, setRows] = useState<Sentence[]>([]);
  const [query, setQuery] = useState('');
  const [study, setStudy] = useState(false);
  const [index, setIndex] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  const refresh = () => getSentences().then(list => setRows(list.sort((a, b) => b.createdAt - a.createdAt)));
  useEffect(() => { void refresh(); }, []);

  const shown = useMemo(
    () => rows.filter(s => `${s.text} ${s.translation} ${s.videoTitle} ${s.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())),
    [rows, query]
  );

  async function remove(id: string) {
    if (!confirm('确定删除这条语句及其本地音频吗？')) return;
    await deleteSentence(id);
    await refresh();
  }

  async function download() {
    const text = await exportLibrary();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cliplingo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(f?: File) {
    if (!f) return;
    try {
      const n = await importLibrary(await f.text());
      alert(`已导入 ${n} 条语句`);
      await refresh();
    } catch (e) {
      alert(String((e as Error).message || e));
    }
  }

  if (study && shown.length) {
    const sentence = shown[Math.min(index, shown.length - 1)];
    return <Study sentence={sentence} current={index + 1} total={shown.length} close={() => setStudy(false)} next={() => setIndex(i => Math.min(i + 1, shown.length - 1))} prev={() => setIndex(i => Math.max(i - 1, 0))} />;
  }

  return <div className="page">
    <header className="topbar">
      <div className="brand"><div className="logo">C</div>我的语句库 <span className="pill">{rows.length} 条</span></div>
      <div className="actions">
        <button className="ghost" onClick={() => file.current?.click()}>导入</button>
        <input ref={file} hidden type="file" accept="application/json" onChange={e => void upload(e.target.files?.[0])} />
        <button className="ghost" onClick={() => void download()}>导出备份</button>
        <button className="primary" disabled={!shown.length} onClick={() => { setIndex(0); setStudy(true); }}>开始复习</button>
      </div>
    </header>
    <main className="library">
      <div className="filters"><input placeholder="搜索原句、翻译、视频或标签…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      {!shown.length
        ? <div className="empty"><div>◌</div><h2>还没有收藏语句</h2><p>打开字幕视频，启动 ClipLingo 学习模式，然后按 Alt + S 收藏当前句。</p></div>
        : <div className="list">{shown.map(sentence => <SentenceCard key={sentence.id} sentence={sentence} remove={remove} />)}</div>}
    </main>
  </div>;
}

function SentenceCard({ sentence, remove }: { sentence: Sentence; remove: (id: string) => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<'idle' | 'loading' | 'playing' | 'looping' | 'scoring'>('idle');
  const [message, setMessage] = useState(sentence.lastScore ? `上次跟读 ${sentence.lastScore} 分` : '');

  useEffect(() => () => { audio.current?.pause(); }, []);

  async function getPlayer(loop: boolean) {
    audio.current?.pause();
    const asset = await requestTts(sentence.text);
    const player = new Audio(asset.source);
    player.loop = loop;
    player.onplay = () => setMode(loop ? 'looping' : 'playing');
    player.onpause = () => { if (!player.ended) setMode('idle'); };
    player.onended = () => setMode('idle');
    audio.current = player;
    return player;
  }

  async function play() {
    if (mode === 'playing' || mode === 'looping') {
      audio.current?.pause();
      setMode('idle');
      return;
    }
    try {
      setMode('loading');
      setMessage('MiniMax 正在生成示范音…');
      await (await getPlayer(false)).play();
      setMessage('');
    } catch (error) {
      setMode('idle');
      setMessage(`播放失败：${errorMessage(error)}`);
    }
  }

  async function toggleLoop() {
    if (mode === 'looping') {
      audio.current?.pause();
      setMode('idle');
      return;
    }
    try {
      setMode('loading');
      setMessage('正在准备循环音频…');
      await (await getPlayer(true)).play();
      setMessage('AI 示范音循环中');
    } catch (error) {
      setMode('idle');
      setMessage(`循环失败：${errorMessage(error)}`);
    }
  }

  async function followRead() {
    try {
      audio.current?.pause();
      setMode('scoring');
      setMessage('先听 AI 示范音…');
      const asset = await requestTts(sentence.text);
      await playToEnd(asset.source);
      setMessage('请开始跟读…');
      const score = await recognizeAndScore(sentence.text, asset.duration);
      await updateSentence(sentence.id, { lastScore: score.score });
      setMessage(`跟读 ${score.score} 分 · 准确 ${score.accuracy} · 流利 ${score.fluency} · 语调 ${score.intonation}`);
      const settings = await loadSettings();
      if (settings.autoCoach) {
        const response = await chrome.runtime.sendMessage({ type: 'COACH_SPEECH', text: sentence.text, score });
        if (response?.ok) {
          const data = JSON.parse(String(response.content || '').replace(/^```json\s*|\s*```$/g, ''));
          if (data.summary) setMessage(previous => `${previous} · ${data.summary}`);
        }
      }
    } catch (error) {
      setMessage(`跟读失败：${errorMessage(error)}`);
    } finally {
      setMode('idle');
    }
  }

  return <article className="sentence card">
    <button className="play" disabled={mode === 'loading' || mode === 'scoring'} onClick={() => void play()}>{mode === 'playing' ? 'Ⅱ' : mode === 'loading' ? '…' : '▶'}</button>
    <div className="copy">
      <h3>{sentence.text}</h3>
      <p>{sentence.translation || '尚未翻译'}</p>
      <div className="meta"><span>{sentence.site}</span><span>{sentence.videoTitle}</span><span>{new Date(sentence.createdAt).toLocaleDateString()}</span></div>
      {message && <div className="practiceStatus">{message}</div>}
    </div>
    <div className="sentenceActions">
      <button className={mode === 'looping' ? 'active' : ''} onClick={() => void toggleLoop()}>{mode === 'looping' ? '停止循环' : '↻ 单句循环'}</button>
      <button disabled={mode === 'scoring'} onClick={() => void followRead()}>{mode === 'scoring' ? '正在评分…' : '◉ 跟读评分'}</button>
    </div>
    <button className="delete" onClick={() => remove(sentence.id)}>×</button>
  </article>;
}

function Study({ sentence, current, total, close, next, prev }: { sentence: Sentence; current: number; total: number; close: () => void; next: () => void; prev: () => void }) {
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setReveal(false), [sentence.id]);
  async function play() {
    try {
      setBusy(true);
      await new Audio((await requestTts(sentence.text)).source).play();
    } finally {
      setBusy(false);
    }
  }
  return <div className="study">
    <header><button onClick={close}>← 返回语句库</button><span>{current} / {total}</span></header>
    <main>
      <div className="source">{sentence.videoTitle}</div>
      <button className="bigPlay" disabled={busy} onClick={() => void play()}>{busy ? '…' : '▶'}</button>
      <h1>{sentence.text}</h1>
      {reveal
        ? <><p className="translationBig">{sentence.translation || '尚未翻译'}</p>{sentence.note && <p className="note">{sentence.note}</p>}</>
        : <button className="reveal" onClick={() => setReveal(true)}>显示中文</button>}
      <div className="studyNav"><button onClick={prev}>上一句</button><button className="primary" onClick={next}>下一句</button></div>
    </main>
  </div>;
}

async function requestTts(text: string) {
  const cached = ttsCache.get(text);
  if (cached) return cached;
  const response = await chrome.runtime.sendMessage({ type: 'MINIMAX_TTS', text });
  if (!response?.ok) throw new Error(response?.error || 'MiniMax 没有返回音频');
  const asset = { source: String(response.audio || ''), duration: Number(response.duration || 0) };
  if (!asset.source) throw new Error('MiniMax 没有返回可播放音频');
  ttsCache.set(text, asset);
  return asset;
}

function playToEnd(source: string) {
  return new Promise<void>((resolve, reject) => {
    const player = new Audio(source);
    player.onended = () => resolve();
    player.onerror = () => reject(new Error('AI 示范音播放失败'));
    void player.play().catch(reject);
  });
}

async function recognizeAndScore(expectedText: string, expectedDuration: number) {
  const speechWindow = window as SpeechWindow;
  const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!Recognition) throw new Error('当前浏览器不支持语音识别');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const analyzer = createSpeechAnalyzer(stream);
  const started = Date.now();
  return new Promise<ReturnType<typeof scoreSpeech>>((resolve, reject) => {
    let spoken = '';
    let recognitionError = '';
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = event => { spoken = event.results[0]?.[0]?.transcript || ''; };
    recognition.onerror = event => { recognitionError = event.error; };
    recognition.onend = () => {
      const elapsed = Date.now() - started;
      stream.getTracks().forEach(track => track.stop());
      const fallbackDuration = Math.max(1000, expectedText.split(/\s+/).length * 450);
      const metrics = analyzer.stop(elapsed / Math.max(1000, expectedDuration || fallbackDuration));
      if (!spoken) reject(new Error(recognitionError || '没有识别到语音'));
      else resolve(scoreSpeech(expectedText, spoken, metrics));
    };
    recognition.start();
  });
}

function createSpeechAnalyzer(stream: MediaStream) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const energies: number[] = [];
  const pitches: number[] = [];
  const interval = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    energies.push(rms);
    const pitch = estimatePitch(samples, context.sampleRate);
    if (pitch > 60 && pitch < 450 && rms > .012) pitches.push(pitch);
  }, 70);
  return {
    stop(durationRatio: number): SpeechMetrics {
      clearInterval(interval);
      void context.close();
      const pauseRatio = energies.length ? energies.filter(value => value < .014).length / energies.length : .5;
      return { durationRatio, pauseRatio, pitchVariation: relativeVariation(pitches), energyVariation: relativeVariation(energies.filter(value => value >= .014)) };
    }
  };
}

function estimatePitch(buffer: Float32Array, sampleRate: number) {
  let bestOffset = -1;
  let bestCorrelation = 0;
  for (let offset = Math.floor(sampleRate / 450); offset <= Math.min(Math.floor(sampleRate / 60), buffer.length / 2); offset += 2) {
    let correlation = 0;
    for (let i = 0; i < buffer.length - offset; i += 4) correlation += buffer[i] * buffer[i + offset];
    if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = offset; }
  }
  return bestOffset > 0 ? sampleRate / bestOffset : 0;
}

function relativeVariation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return mean ? Math.sqrt(variance) / mean : 0;
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error);
}

createRoot(document.getElementById('root')!).render(<App />);
