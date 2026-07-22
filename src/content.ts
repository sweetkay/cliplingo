interface CueData { id: string; text: string; start: number; end: number; }
interface Settings { apiBaseUrl: string; apiKey: string; model: string; targetLanguage: string; fontSize: number; opacity: number; pauseOnSentenceClick: boolean; loopCount: number; playbackRate: number; translationPrompt: string; }
interface ScoreResult { score: number; accuracy: number; completeness: number; fluency: number; words: Array<{ word: string; state: 'correct' | 'missing' | 'extra' }>; }

interface Window { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike; }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

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
  try {
    const texts = translationBatch(cue);
    const response = await chrome.runtime.sendMessage({ type: 'AI_TRANSLATE', texts });
    if (!response?.ok) throw new Error(response?.error);
    const raw = response.content.replace(/^```json\s*|\s*```$/g, '');
    let results: string[];
    try { results = JSON.parse(raw); } catch { results = [raw]; }
    texts.forEach((text, index) => translated.set(text, results[index] || ''));
  } catch (error) { translated.set(cue.text, `翻译不可用 · ${String((error as Error).message || error)}`); }
  render();
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
  const cue = currentCue;
  shadow.innerHTML = `<style>${overlayCss}</style><section class="panel" style="--alpha:${(settings?.opacity || 82) / 100};--size:${settings?.fontSize || 22}px">
    <div class="drag">CLIPLINGO <span>${siteName()}</span></div>
    <div class="english" title="点击句子暂停">${cue ? tokenize(cue.text) : '等待字幕…'}</div>
    <div class="translation">${cue ? escapeHtml(translated.get(cue.text) || '正在翻译…') : '请播放带字幕的视频'}</div>
    <div class="tools">
      <button data-action="loop" class="${loop ? 'active' : ''}">↻ ${loop ? '循环中' : '单句循环'}</button>
      <button data-action="save">＋ 收藏</button><button data-action="speak">◉ 跟读</button><button data-action="explain">✦ AI讲解</button>
      <select data-action="rate"><option>.5×</option><option>.75×</option><option selected>1×</option><option>1.25×</option></select>
      <button data-action="close">×</button>
    </div>
    <div class="result ${score || error ? 'show' : ''}">${error ? escapeHtml(error) : score ? renderScore(score) : ''}</div>
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
  if (action === 'speak') await startSpeaking();
  if (action === 'explain') await explainCurrent();
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

async function explainCurrent() {
  if (!currentCue) return;
  toast('正在生成讲解…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'AI_EXPLAIN', text: currentCue.text });
    const raw = response.content.replace(/^```json\s*|\s*```$/g, '');
    const data = JSON.parse(raw);
    const box = shadow?.querySelector<HTMLElement>('.result');
    if (box) { box.classList.add('show'); box.innerHTML = `<b>${escapeHtml(data.translation || '')}</b><p>${escapeHtml(data.structure || '')}</p><p>${escapeHtml(String(data.phrases || ''))}</p><p class="muted">${escapeHtml(data.tone || '')}</p>`; }
  } catch (e) { toast(`讲解失败：${String((e as Error).message || e)}`); }
}

async function startSpeaking() {
  if (!currentCue || !video) return;
  const cue = currentCue;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return render(undefined, '当前浏览器不支持语音识别');
  video.pause();
  video.currentTime = Math.max(0, cue.start - .3);
  await video.play();
  await new Promise(resolve => setTimeout(resolve, Math.max(600, (cue.end - cue.start + .8) * 1000)));
  video.pause();
  const started = Date.now();
  toast('请开始跟读…');
  const recognition = new Recognition(); recognition.lang = 'en-US'; recognition.interimResults = false; recognition.continuous = false;
  recognition.onresult = event => {
    const spoken = event.results[0]?.[0]?.transcript || '';
    const expectedMs = Math.max(1000, (cue.end - cue.start) * 1000);
    render(scoreSpeech(cue.text, spoken, (Date.now() - started) / expectedMs));
  };
  recognition.onerror = event => render(undefined, `跟读识别失败：${event.error}`);
  recognition.start();
}

function toast(message: string) {
  const box = shadow?.querySelector<HTMLElement>('.result');
  if (!box) return; box.classList.add('show'); box.textContent = message;
  window.setTimeout(() => box.classList.remove('show'), 2600);
}
function siteName() { return location.hostname.includes('youtube') ? 'YouTube' : location.hostname.includes('bilibili') ? 'Bilibili' : location.hostname; }
function escapeHtml(s: string) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function tokenize(text: string) { return text.split(/(\b[a-zA-Z][a-zA-Z’']*\b)/).map((part, i) => /^[a-zA-Z]/.test(part) ? `<button class="word" data-word="${escapeHtml(part)}" data-i="${i}">${escapeHtml(part)}</button>` : escapeHtml(part)).join(''); }
function renderScore(s: ScoreResult) { return `<div class="scores"><b>${s.score}分</b><span>准确 ${s.accuracy}</span><span>完整 ${s.completeness}</span><span>流利 ${s.fluency}</span></div><p>${s.words.map(w => `<i class="${w.state}">${escapeHtml(w.word)}</i>`).join(' ')}</p>`; }

async function loadSettings(): Promise<Settings> {
  const defaults: Settings = { apiBaseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini', targetLanguage: '简体中文', fontSize: 22, opacity: 82, pauseOnSentenceClick: true, loopCount: 0, playbackRate: 1, translationPrompt: '' };
  const data = await chrome.storage.local.get('settings');
  return { ...defaults, ...(data.settings || {}) };
}

function normalizeWords(text: string) { return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); }
function scoreSpeech(expectedText: string, spokenText: string, durationRatio = 1): ScoreResult {
  const expected = normalizeWords(expectedText), spoken = normalizeWords(spokenText);
  const dp = Array.from({ length: expected.length + 1 }, () => Array(spoken.length + 1).fill(0));
  for (let i = 1; i <= expected.length; i++) for (let j = 1; j <= spoken.length; j++) dp[i][j] = expected[i-1] === spoken[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  let i = expected.length, j = spoken.length; const words: ScoreResult['words'] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i-1] === spoken[j-1]) { words.unshift({ word: expected[i-1], state: 'correct' }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { words.unshift({ word: spoken[j-1], state: 'extra' }); j--; }
    else { words.unshift({ word: expected[i-1], state: 'missing' }); i--; }
  }
  const correct = words.filter(w => w.state === 'correct').length;
  const accuracy = spoken.length ? Math.round(correct / spoken.length * 100) : 0, completeness = expected.length ? Math.round(correct / expected.length * 100) : 0, fluency = Math.round(Math.max(0, Math.min(100, 100 - Math.abs(1-durationRatio)*65)));
  return { accuracy, completeness, fluency, score: Math.round(accuracy*.45 + completeness*.35 + fluency*.2), words };
}

const overlayCss = `
  :host{all:initial}.panel{position:fixed;left:50%;bottom:7.5%;transform:translateX(-50%);width:min(840px,82vw);z-index:2147483646;color:#fff;background:rgba(10,12,18,var(--alpha));border:1px solid #ffffff24;border-radius:16px;padding:10px 18px 12px;box-shadow:0 18px 60px #0008;backdrop-filter:blur(16px);font-family:Inter,system-ui,sans-serif;text-align:center}.drag{font-size:9px;letter-spacing:.18em;color:#8f99ac;text-align:left}.drag span{float:right;letter-spacing:0;text-transform:none}.english{font-size:var(--size);font-weight:650;line-height:1.45;margin-top:4px}.translation{font-size:calc(var(--size)*.72);color:#c6cede;line-height:1.45;min-height:1.45em}.word{all:unset;cursor:pointer;border-radius:4px}.word:hover{color:#a99cff;background:#7867e922}.tools{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:9px}.tools button,.tools select{border:1px solid #ffffff18;color:#dae0ec;background:#ffffff0e;border-radius:8px;padding:5px 8px;font:11px system-ui;cursor:pointer}.tools button:hover,.tools .active{background:#7667e8;color:white}.result{display:none;margin-top:9px;padding:10px;background:#080a0ecc;border-radius:10px;font:13px/1.5 system-ui;text-align:left}.result.show{display:block}.scores{display:flex;gap:12px;align-items:center}.scores b{font-size:20px;color:#9b8cff}.result i{font-style:normal;padding:2px 3px;border-radius:3px}.result .correct{color:#79d9a5}.result .missing{color:#ff8090;text-decoration:line-through}.result .extra{color:#f4bd6d}.wordcard{display:none;position:fixed;right:24px;bottom:20%;z-index:2147483647;width:290px;padding:16px;color:#edf1f7;background:#12151ddd;border:1px solid #ffffff22;border-radius:14px;box-shadow:0 15px 50px #0009;backdrop-filter:blur(18px);font:13px/1.5 system-ui}.wordcard.show{display:block}.wordcard h3{margin:0 0 4px;font-size:20px}.wordcard small,.wordcard em,.wordcard .muted{color:#929caf}.wordcard .x{float:right;color:#aaa;background:none;border:0;font-size:18px;cursor:pointer}
`;
