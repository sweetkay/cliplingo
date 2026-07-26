import { loadSettings } from './shared/settings';
import { getSentences, putSentence } from './shared/db';
import type { ScoreResult } from './shared/types';

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
    case 'AI_TRANSLATE': return translateSubtitles(message.texts as string[]);
    case 'AI_WORD': return chat(`Explain the English word ${JSON.stringify(message.word)} in this context: ${JSON.stringify(message.context)}. Return concise JSON with keys lemma, partOfSpeech, phonetic, meaning, usage.`, '你是面向中文母语者的英语学习助手，只返回有效 JSON。');
    case 'TEST_MINIMAX_TEXT': return chat('只回复 OK。', '你正在测试 API 连接。');
    case 'MINIMAX_TTS': return synthesize(String(message.text || ''));
    case 'GET_MINIMAX_VOICES': return getMiniMaxVoices();
    case 'COACH_SPEECH': return coachSpeech(String(message.text || ''), message.score as ScoreResult);
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

async function chat(userContent: string, systemContent?: string, model?: string) {
  const settings = await loadSettings();
  if (!settings.apiKey) throw new Error('请先在设置中配置大模型 API Key');
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: model || settings.model,
      temperature: 0.2,
      messages: [{ role: 'system', content: systemContent || settings.translationPrompt }, { role: 'user', content: userContent }]
    })
  });
  if (!response.ok) throw new Error(`API 请求失败 (${response.status})`);
  const json = await response.json();
  return { ok: true, content: json.choices?.[0]?.message?.content || '' };
}

async function translateSubtitles(texts: string[]) {
  const settings = await loadSettings();
  return chat(
    `Translate each English subtitle into natural Simplified Chinese. Return only a JSON array of strings in the same order.\n\n${JSON.stringify(texts)}`,
    settings.translationPrompt,
    settings.translationModel
  );
}

async function getMiniMaxVoices() {
  const settings = await loadSettings();
  if (!settings.apiKey) throw new Error('请先在设置中配置 MiniMax API Key');
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}/get_voice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ voice_type: 'all' })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.base_resp?.status_code) throw new Error(json.base_resp?.status_msg || `读取 Voice ID 失败 (${response.status})`);
  const voices = [
    ...(json.system_voice || []).map((voice: Record<string, unknown>) => ({ ...voice, type: 'system' })),
    ...(json.voice_cloning || []).map((voice: Record<string, unknown>) => ({ ...voice, type: 'voice_cloning' })),
    ...(json.voice_generation || []).map((voice: Record<string, unknown>) => ({ ...voice, type: 'voice_generation' }))
  ];
  return { ok: true, voices };
}

async function synthesize(text: string) {
  const settings = await loadSettings();
  if (!settings.apiKey) throw new Error('请先在设置中配置 MiniMax API Key');
  if (!text.trim()) throw new Error('当前没有可生成的台词');
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}/t2a_v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.speechModel,
      text,
      stream: false,
      voice_setting: {
        voice_id: settings.speechVoiceId,
        speed: settings.speechSpeed,
        vol: 1,
        pitch: 0,
        emotion: settings.speechEmotion
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      language_boost: 'English',
      subtitle_enable: false
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.base_resp?.status_code) throw new Error(json.base_resp?.status_msg || `MiniMax 语音请求失败 (${response.status})`);
  const hex = json.data?.audio;
  if (!hex) throw new Error('MiniMax 没有返回音频');
  return { ok: true, audio: `data:audio/mpeg;base64,${hexToBase64(hex)}`, duration: json.extra_info?.audio_length || 0 };
}

async function coachSpeech(text: string, score: ScoreResult) {
  const prompt = `你是严谨、鼓励型的英语口语教练。根据目标台词和本地跟读评测，用简体中文给出简短反馈。
目标台词：${JSON.stringify(text)}
识别结果：${JSON.stringify(score?.spokenText || '')}
分数：${JSON.stringify(score)}
只返回 JSON，字段为 summary（1句话）、strengths（字符串数组，最多2项）、improvements（字符串数组，最多3项）、practice（1条可以立刻执行的练习指令）。不要声称听到了录音，也不要给出无法从数据判断的音素结论。`;
  return chat(prompt, '你是严谨、具体、鼓励型的英语口语教练，只返回有效 JSON。');
}

function hexToBase64(hex: string) {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
