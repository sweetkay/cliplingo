import { loadSettings } from './shared/settings';
import { getSentences, putSentence } from './shared/db';

type RuntimeMessage = { type: string; [key: string]: unknown };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installComplete: true });
});

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.target === 'offscreen') return false;
  void handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'START_CAPTURE': return startCapture(Number(message.tabId));
    case 'STOP_CAPTURE': return relayOffscreen({ type: 'OFFSCREEN_STOP' });
    case 'CLIP_REQUEST': return relayOffscreen(message);
    case 'SAVE_SENTENCE': {
      const sentence = message.sentence as Parameters<typeof putSentence>[0];
      const duplicate = (await getSentences()).find(row => row.sourceUrl === sentence.sourceUrl && Math.abs(row.startTime - sentence.startTime) < .35 && row.text === sentence.text);
      if (duplicate) return { ok: true, duplicate: true, id: duplicate.id };
      await putSentence(sentence);
      return { ok: true, duplicate: false };
    }
    case 'AI_TRANSLATE': return chat(`Translate each subtitle into Simplified Chinese. Return only a JSON array of strings in the same order.\n\n${JSON.stringify(message.texts)}`);
    case 'AI_WORD': return chat(`Explain the English word ${JSON.stringify(message.word)} in this context: ${JSON.stringify(message.context)}. Return concise JSON with keys lemma, partOfSpeech, phonetic, meaning, usage.`);
    case 'AI_EXPLAIN': return chat(`Explain this English sentence to a Chinese learner. Return concise JSON with keys translation, structure, phrases, tone, alternatives, examples. Sentence: ${JSON.stringify(message.text)}`);
    case 'GET_TAB_STATUS': return (await chrome.storage.session.get(`tab:${message.tabId}`))[`tab:${message.tabId}`] || { active: false };
    case 'SET_TAB_STATUS': {
      const tabId = Number(message.tabId || sender.tab?.id);
      await chrome.storage.session.set({ [`tab:${tabId}`]: message.status });
      return { ok: true };
    }
    default: return { ok: false, error: 'Unknown message' };
  }
}

async function startCapture(tabId: number) {
  if (!tabId) throw new Error('找不到当前标签页');
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const response = await relayOffscreen({ type: 'OFFSCREEN_START', streamId, tabId });
  await chrome.storage.session.set({ [`tab:${tabId}`]: { active: true, capture: response?.ok ? 'active' : 'failed' } });
  return response;
}

async function ensureOffscreen() {
  const path = 'src/offscreen/index.html';
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: path, reasons: [chrome.offscreen.Reason.USER_MEDIA], justification: '捕获用户主动开启学习模式的标签页音频，用于保存语句原声。' });
}

async function relayOffscreen(message: RuntimeMessage) {
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

async function chat(userContent: string) {
  const settings = await loadSettings();
  if (!settings.apiKey) throw new Error('请先在设置中配置大模型 API Key');
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [{ role: 'system', content: settings.translationPrompt }, { role: 'user', content: userContent }]
    })
  });
  if (!response.ok) throw new Error(`API 请求失败 (${response.status})`);
  const json = await response.json();
  return { ok: true, content: json.choices?.[0]?.message?.content || '' };
}
