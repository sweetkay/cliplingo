import { scoreSpeech } from './shared/scoring';
import { defaultSettings, type ScoreResult, type Settings, type SpeechMetrics } from './shared/types';

interface CueData { id: string; text: string; start: number; end: number; }

interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechWindow = Window & typeof globalThis & {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
};

let video: HTMLVideoElement | null = null;
let active = false;
let currentCue: CueData | null = null;
let settings: Settings;
let loop = false;
let overlayHost: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let translated = new Map<string, string>();
let loopIteration = 0;
let lastText = '';
let timer: number | null = null;
let latestScore: ScoreResult | null = null;
let coachFeedback = '';
let resultError = '';
let generatedAudio: HTMLAudioElement | null = null;
const ttsCache = new Map<string, string>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message.type === 'START_LEARNING') { await startLearning(); sendResponse({ ok: true, subtitle: Boolean(currentCue) }); }
    else if (message.type === 'STOP_LEARNING') { stopLearning(); sendResponse({ ok: true }); }
    else if (message.type === 'COMMAND') { await handleCommand(message.command); sendResponse({ ok: true }); }
    else if (message.type === 'PING') sendResponse({ ok: true, active, hasVideo: Boolean(findVideo()), subtitle: currentCue?.text || '' });
  })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function startLearning() {
  settings = await loadSettings();
  video = findVideo();
  if (!video) throw new Error('当前页面没有检测到视频');
  active = true;
  createOverlay();
  video.addEventListener('timeupdate', onTimeUpdate);
  if (timer) clearInterval(timer);
  timer = window.setInterval(tick, 180);
  tick();
}

function stopLearning() {
  active = false;
  video?.removeEventListener('timeupdate', onTimeUpdate);
  overlayHost?.remove(); overlayHost = null; shadow = null;
  if (timer) clearInterval(timer); timer = null;
}

function findVideo() {
  return [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
}

function getCue(): CueData | null {
  if (!video) return null;
  for (const track of Array.from(video.textTracks || [])) {
    const cue = track.activeCues?.[0] as VTTCue | undefined;
    if (cue?.text) return { id: `${cue.startTime}-${cue.endTime}-${cue.text}`, text: clean(cue.text), start: cue.startTime, end: cue.endTime };
  }
  const selectors = [
    '.ytp-caption-segment', '.bpx-player-subtitle-panel-text', '.bilibili-player-video-subtitle-item',
    '[class*="subtitle"] [class*="text"]', '[class*="caption"] [class*="text"]'
  ];
  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll<HTMLElement>(selector)].filter(el => isVisible(el));
    const text = clean(nodes.map(node => node.innerText).join(' '));
    if (text && text.length < 500) {
      const now = video.currentTime;
      return { id: `${Math.floor(now * 2)}-${text}`, text, start: Math.max(0, now - .5), end: now + 3.5 };
    }
  }
  return null;
}

function clean(text: string) { return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function isVisible(el: HTMLElement) { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }

function tick() {
  if (!active || !video) return;
  const cue = getCue();
  if (cue && cue.text !== lastText) {
    currentCue = cue; lastText = cue.text; loopIteration = 0;
    latestScore = null; coachFeedback = ''; resultError = '';
    render(); void translate(cue);
  }
  onTimeUpdate();
}

function onTimeUpdate() {
  if (!video || !currentCue || !loop || video.paused) return;
  if (video.currentTime >= currentCue.end + .5) {
    loopIteration++;
    if (settings.loopCount > 0 && loopIteration >= settings.loopCount) { loop = false; render(); return; }
    video.currentTime = Math.max(0, currentCue.start - .3);
    void video.play();
  }
}

async function translate(cue: CueData) {
  if (translated.has(cue.text)) return render();
  if (settings.translationMode === 'off') { translated.set(cue.text, '翻译已关闭'); return render(); }
  try {
    const texts = translationBatch(cue);
    let results: string[];
    if (settings.translationMode === 'chrome-fallback-minimax') {
      try { results = await translateOnDevice(texts); }
      catch { results = await translateWithMiniMax(texts); }
    } else results = await translateWithMiniMax(texts);
    texts.forEach((text, index) => translated.set(text, results[index] || ''));
  } catch (error) { translated.set(cue.text, `翻译不可用 · ${String((error as Error).message || error)}`); }
  render();
}

async function translateOnDevice(texts: string[]) {
  type TranslatorInstance = { translate(text: string): Promise<string>; destroy?(): void };
  type TranslatorApi = {
    availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
    create(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
  };
  const api = (globalThis as typeof globalThis & { Translator?: TranslatorApi }).Translator;
  if (!api) throw new Error('Chrome 本地翻译不可用');
  const options = { sourceLanguage: 'en', targetLanguage: 'zh' };
  const availability = await api.availability(options);
  if (availability === 'unavailable') throw new Error('Chrome 不支持当前语言包');
  const translator = await api.create(options);
  try { return await Promise.all(texts.map(text => translator.translate(text))); }
  finally { translator.destroy?.(); }
}

async function translateWithMiniMax(texts: string[]) {
  const response = await chrome.runtime.sendMessage({ type: 'AI_TRANSLATE', texts });
  if (!response?.ok) throw new Error(response?.error);
  const raw = response.content.replace(/^```json\s*|\s*```$/g, '');
  try { return JSON.parse(raw) as string[]; } catch { return [raw]; }
}

function translationBatch(cue: CueData) {
  if (!video) return [cue.text];
  for (const track of Array.from(video.textTracks || [])) {
    const cues = Array.from(track.cues || []) as VTTCue[];
    const index = cues.findIndex(item => Math.abs(item.startTime - cue.start) < .05 || clean(item.text) === cue.text);
    if (index >= 0) return [...new Set(cues.slice(index, index + 12).map(item => clean(item.text)).filter(Boolean))];
  }
  return [cue.text];
}

function createOverlay() {
  overlayHost?.remove();
  overlayHost = document.createElement('div');
  overlayHost.id = 'cliplingo-root';
  shadow = overlayHost.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(overlayHost);
  render();
}

function render(score?: ScoreResult, error = '') {
  if (!shadow) return;
  if (score) { latestScore = score; resultError = ''; }
  if (error) { resultError = error; latestScore = null; coachFeedback = ''; }
  const cue = currentCue;
  shadow.innerHTML = `<style>${overlayCss}</style><section class="panel" style="--alpha:${(settings?.opacity || 82) / 100};--size:${settings?.fontSize || 22}px">
    <div class="drag">CLIPLINGO <span>${siteName()}</span></div>
    <div class="english" title="点击句子暂停">${cue ? tokenize(cue.text) : '等待字幕…'}</div>
    <div class="translation">${cue ? escapeHtml(translated.get(cue.text) || '正在翻译…') : '请播放带字幕的视频'}</div>
    <div class="tools">
      <button data-action="loop" class="${loop ? 'active' : ''}">↻ ${loop ? '循环中' : '单句循环'}</button>
      <button data-action="save">＋ 收藏</button><button data-action="tts">▶ AI示范</button><button data-action="speak">◉ 跟读评分</button>
      <select data-action="rate"><option>.5×</option><option>.75×</option><option selected>1×</option><option>1.25×</option></select>
      <button data-action="close">×</button>
    </div>
    <div class="result ${latestScore || resultError || coachFeedback ? 'show' : ''}">${resultError ? escapeHtml(resultError) : latestScore ? `${renderScore(latestScore)}${coachFeedback}` : coachFeedback}</div>
  </section><aside class="wordcard"></aside>`;
  shadow.querySelector('.english')?.addEventListener('click', event => {
    const word = (event.target as HTMLElement).dataset.word;
    if (word) { event.stopPropagation(); void lookupWord(word); }
    else if (settings.pauseOnSentenceClick && video) video.paused ? void video.play() : video.pause();
  });
  shadow.querySelectorAll<HTMLElement>('[data-action]').forEach(el => el.addEventListener('click', () => void handleAction(el.dataset.action || '')));
  const rate = shadow.querySelector<HTMLSelectElement>('select[data-action="rate"]');
  if (rate && video) { rate.value = `${video.playbackRate}×`.replace('1×','1×'); rate.onchange = () => { if (video) video.playbackRate = Number(rate.value.replace('×','')); }; }
}

async function handleAction(action: string) {
  if (action === 'loop') { loop = !loop; loopIteration = 0; if (loop && video && currentCue) { video.currentTime = Math.max(0, currentCue.start - .3); void video.play(); } render(); }
  if (action === 'save') await saveCurrent();
  if (action === 'tts') await playAiExample();
  if (action === 'speak') await startSpeaking();
  if (action === 'coach' && currentCue && latestScore) await requestCoach(currentCue.text, latestScore);
  if (action === 'close') stopLearning();
}

async function handleCommand(command: string) {
  if (command === 'save-current') await saveCurrent();
  if (command === 'toggle-loop') await handleAction('loop');
  if (command === 'toggle-overlay') overlayHost ? stopLearning() : await startLearning();
}

async function saveCurrent() {
  if (!video || !currentCue) return toast('当前没有可收藏的字幕');
  const id = crypto.randomUUID();
  const now = Date.now();
  const sentence = {
    id, text: currentCue.text, translation: translated.get(currentCue.text) || '', startTime: currentCue.start, endTime: currentCue.end,
    sourceUrl: location.href, videoTitle: document.title, site: siteName(), createdAt: now, updatedAt: now, tags: [], note: '', words: [], mastery: 'new' as const, audioState: 'pending' as const
  };
  const stored = await chrome.runtime.sendMessage({ type: 'SAVE_SENTENCE', sentence });
  if (stored?.duplicate) return toast('这条语句已经收藏');
  const startedAt = now - Math.max(0, video.currentTime - currentCue.start + .3) * 1000;
  const endedAt = now + Math.max(0, currentCue.end - video.currentTime + .5) * 1000;
  const response = await chrome.runtime.sendMessage({ type: 'CLIP_REQUEST', sentenceId: id, startedAt, endedAt });
  toast(response?.ok ? '已收藏原句和原声' : '已收藏，音频将使用在线回放');
}

async function lookupWord(word: string) {
  const card = shadow?.querySelector<HTMLElement>('.wordcard');
  if (!card || !currentCue) return;
  card.classList.add('show'); card.innerHTML = `<b>${escapeHtml(word)}</b><p>正在查询语境释义…</p>`;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'AI_WORD', word, context: currentCue.text });
    const raw = response.content.replace(/^```json\s*|\s*```$/g, '');
    const data = JSON.parse(raw);
    card.innerHTML = `<button class="x">×</button><h3>${escapeHtml(data.lemma || word)} <small>${escapeHtml(data.phonetic || '')}</small></h3><em>${escapeHtml(data.partOfSpeech || '')}</em><p>${escapeHtml(data.meaning || '')}</p><p class="muted">${escapeHtml(data.usage || '')}</p>`;
    card.querySelector('.x')?.addEventListener('click', () => card.classList.remove('show'));
  } catch (e) { card.innerHTML = `<p>查询失败：${escapeHtml(String((e as Error).message || e))}</p>`; }
}

async function playAiExample() {
  if (!currentCue) return;
  const key = `${settings.speechModel}|${settings.speechVoiceId}|${settings.speechSpeed}|${currentCue.text}`;
  try {
    generatedAudio?.pause();
    let source = ttsCache.get(key);
    if (!source) {
      toast('MiniMax 正在生成示范音…');
      const response = await chrome.runtime.sendMessage({ type: 'MINIMAX_TTS', text: currentCue.text });
      if (!response?.ok) throw new Error(response?.error);
      source = String(response.audio || '');
      if (!source) throw new Error('MiniMax 没有返回可播放音频');
      ttsCache.set(key, source);
    }
    generatedAudio = new Audio(source);
    await generatedAudio.play();
  } catch (error) { render(undefined, `AI示范失败：${String((error as Error).message || error)}`); }
}

async function startSpeaking() {
  if (!currentCue || !video) return;
  const cue = currentCue;
  const speechWindow = window as SpeechWindow;
  const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!Recognition) return render(undefined, '当前浏览器不支持语音识别');
  video.pause();
  video.currentTime = Math.max(0, cue.start - .3);
  await video.play();
  await new Promise(resolve => setTimeout(resolve, Math.max(600, (cue.end - cue.start + .8) * 1000)));
  video.pause();
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
  catch (error) { return render(undefined, `无法使用麦克风：${String((error as Error).message || error)}`); }
  const analyzer = createSpeechAnalyzer(stream);
  const started = Date.now();
  let spoken = '';
  let recognitionError = '';
  toast('请开始跟读…');
  const recognition = new Recognition();
  recognition.lang = 'en-US'; recognition.interimResults = false; recognition.continuous = false;
  recognition.onresult = event => { spoken = event.results[0]?.[0]?.transcript || ''; };
  recognition.onerror = event => { recognitionError = event.error; };
  recognition.onend = () => {
    const elapsed = Date.now() - started;
    const expectedMs = Math.max(1000, (cue.end - cue.start) * 1000);
    stream.getTracks().forEach(track => track.stop());
    const metrics = analyzer.stop(elapsed / expectedMs);
    if (!spoken) return render(undefined, `跟读识别失败：${recognitionError || '没有识别到语音'}`);
    const score = scoreSpeech(cue.text, spoken, metrics);
    render(score);
    if (settings.autoCoach) void requestCoach(cue.text, score);
  };
  recognition.start();
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
      return {
        durationRatio,
        pauseRatio,
        pitchVariation: relativeVariation(pitches),
        energyVariation: relativeVariation(energies.filter(value => value >= .014))
      };
    }
  };
}

function estimatePitch(buffer: Float32Array, sampleRate: number) {
  let bestOffset = -1, bestCorrelation = 0;
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

async function requestCoach(text: string, score: ScoreResult) {
  try {
    coachFeedback = '<div class="coach loading">MiniMax 口语教练正在分析…</div>';
    render();
    const response = await chrome.runtime.sendMessage({ type: 'COACH_SPEECH', text, score });
    if (!response?.ok) throw new Error(response?.error);
    const raw = response.content.replace(/^```json\s*|\s*```$/g, '');
    const data = JSON.parse(raw);
    coachFeedback = `<div class="coach"><b>MiniMax 教练</b><p>${escapeHtml(data.summary || '')}</p>${renderList(data.strengths, '做得好')}${renderList(data.improvements, '重点改进')}<p class="practice">练习：${escapeHtml(data.practice || '')}</p></div>`;
  } catch (error) {
    coachFeedback = `<div class="coach muted">教练反馈暂不可用：${escapeHtml(String((error as Error).message || error))}</div>`;
  }
  render();
}

function renderList(value: unknown, title: string) {
  if (!Array.isArray(value) || !value.length) return '';
  return `<div class="coachList"><strong>${title}</strong><ul>${value.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul></div>`;
}

function toast(message: string) {
  const box = shadow?.querySelector<HTMLElement>('.result');
  if (!box) return; box.classList.add('show'); box.textContent = message;
  window.setTimeout(() => box.classList.remove('show'), 2600);
}
function siteName() { return location.hostname.includes('youtube') ? 'YouTube' : location.hostname.includes('bilibili') ? 'Bilibili' : location.hostname; }
function escapeHtml(s: string) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function tokenize(text: string) { return text.split(/(\b[a-zA-Z][a-zA-Z’']*\b)/).map((part, i) => /^[a-zA-Z]/.test(part) ? `<button class="word" data-word="${escapeHtml(part)}" data-i="${i}">${escapeHtml(part)}</button>` : escapeHtml(part)).join(''); }
function renderScore(s: ScoreResult) { return `<div class="scores"><b>${s.score}分</b><span>准确 ${s.accuracy}</span><span>完整 ${s.completeness}</span><span>流利 ${s.fluency}</span><span>节奏 ${s.rhythm}</span><span>语调 ${s.intonation}</span></div><p>${s.words.map(w => `<i class="${w.state}">${escapeHtml(w.word)}</i>`).join(' ')}</p><p class="muted">识别：${escapeHtml(s.spokenText)}</p>${coachFeedback ? '' : '<button class="coachButton" data-action="coach">获取 MiniMax 教练反馈</button>'}`; }

async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...defaultSettings, ...(data.settings || {}) };
}

const overlayCss = `
  :host{all:initial}.panel{position:fixed;left:50%;bottom:7.5%;transform:translateX(-50%);width:min(900px,86vw);z-index:2147483646;color:#fff;background:rgba(10,12,18,var(--alpha));border:1px solid #ffffff24;border-radius:16px;padding:10px 18px 12px;box-shadow:0 18px 60px #0008;backdrop-filter:blur(16px);font-family:Inter,system-ui,sans-serif;text-align:center}.drag{font-size:9px;letter-spacing:.18em;color:#8f99ac;text-align:left}.drag span{float:right;letter-spacing:0;text-transform:none}.english{font-size:var(--size);font-weight:650;line-height:1.45;margin-top:4px}.translation{font-size:calc(var(--size)*.72);color:#c6cede;line-height:1.45;min-height:1.45em}.word{all:unset;cursor:pointer;border-radius:4px}.word:hover{color:#a99cff;background:#7867e922}.tools{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:9px;flex-wrap:wrap}.tools button,.tools select{border:1px solid #ffffff18;color:#dae0ec;background:#ffffff0e;border-radius:8px;padding:5px 8px;font:11px system-ui;cursor:pointer}.tools button:hover,.tools .active{background:#7667e8;color:white}.result{display:none;margin-top:9px;padding:10px;background:#080a0ecc;border-radius:10px;font:13px/1.5 system-ui;text-align:left;max-height:250px;overflow:auto}.result.show{display:block}.scores{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.scores b{font-size:20px;color:#9b8cff}.result i{font-style:normal;padding:2px 3px;border-radius:3px}.result .correct{color:#79d9a5}.result .missing{color:#ff8090;text-decoration:line-through}.result .extra{color:#f4bd6d}.result .muted{color:#929caf}.coachButton{border:1px solid #7867e8;color:#d8d1ff;background:#7867e922;border-radius:7px;padding:5px 9px;cursor:pointer}.coach{border-top:1px solid #ffffff16;margin-top:9px;padding-top:9px}.coach b{color:#b5aaff}.coach p{margin:4px 0}.coachList{display:grid;grid-template-columns:64px 1fr;gap:4px;margin-top:5px}.coachList ul{margin:0;padding-left:18px}.practice{color:#d8d1ff}.wordcard{display:none;position:fixed;right:24px;bottom:20%;z-index:2147483647;width:290px;padding:16px;color:#edf1f7;background:#12151ddd;border:1px solid #ffffff22;border-radius:14px;box-shadow:0 15px 50px #0009;backdrop-filter:blur(18px);font:13px/1.5 system-ui}.wordcard.show{display:block}.wordcard h3{margin:0 0 4px;font-size:20px}.wordcard small,.wordcard em,.wordcard .muted{color:#929caf}.wordcard .x{float:right;color:#aaa;background:none;border:0;font-size:18px;cursor:pointer}
`;
