import { updateSentence } from '../shared/db';

interface AudioChunk { blob: Blob; startedAt: number; endedAt: number; }
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: AudioChunk[] = [];
let lastChunkAt = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'OFFSCREEN_START') void start(message.streamId).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: String(error) }));
  if (message.type === 'OFFSCREEN_STOP') { stop(); sendResponse({ ok: true }); }
  if (message.type === 'CLIP_REQUEST') void saveClip(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function start(streamId: string) {
  stop();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false
  });
  const audio = new Audio();
  audio.srcObject = stream;
  await audio.play();
  chunks = [];
  lastChunkAt = Date.now();
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
  recorder.ondataavailable = event => {
    const now = Date.now();
    if (event.data.size) chunks.push({ blob: event.data, startedAt: lastChunkAt, endedAt: now });
    lastChunkAt = now;
    chunks = chunks.filter(chunk => chunk.endedAt > now - 120000);
  };
  recorder.start(250);
}

function stop() {
  if (recorder?.state !== 'inactive') recorder?.stop();
  stream?.getTracks().forEach(track => track.stop());
  recorder = null; stream = null; chunks = [];
}

async function saveClip(message: { sentenceId: string; startedAt: number; endedAt: number }) {
  const wait = Math.max(0, message.endedAt - Date.now() + 350);
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  const selected = chunks.filter(chunk => chunk.endedAt >= message.startedAt && chunk.startedAt <= message.endedAt);
  if (!selected.length) {
    await updateSentence(message.sentenceId, { audioState: 'online' });
    return { ok: false, fallback: true };
  }
  const audioBlob = new Blob(selected.map(chunk => chunk.blob), { type: selected[0].blob.type });
  await updateSentence(message.sentenceId, { audioBlob, audioState: 'saved' });
  return { ok: true, bytes: audioBlob.size };
}
