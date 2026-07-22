export type AudioState = 'pending' | 'saved' | 'online' | 'failed';
export type Mastery = 'new' | 'learning' | 'mastered';

export interface Sentence {
  id: string;
  text: string;
  translation: string;
  startTime: number;
  endTime: number;
  sourceUrl: string;
  videoTitle: string;
  site: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  note: string;
  words: string[];
  mastery: Mastery;
  audioState: AudioState;
  audioBlob?: Blob;
  lastScore?: number;
}

export interface Settings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  transcriptionBaseUrl: string;
  transcriptionApiKey: string;
  transcriptionModel: string;
  targetLanguage: string;
  fontSize: number;
  opacity: number;
  pauseOnSentenceClick: boolean;
  loopCount: number;
  playbackRate: number;
  translationPrompt: string;
}

export const defaultSettings: Settings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  transcriptionBaseUrl: 'https://api.openai.com/v1',
  transcriptionApiKey: '',
  transcriptionModel: 'whisper-1',
  targetLanguage: '简体中文',
  fontSize: 22,
  opacity: 82,
  pauseOnSentenceClick: true,
  loopCount: 0,
  playbackRate: 1,
  translationPrompt: '你是英语学习助手。结合上下文，将英文字幕自然、准确地翻译为简体中文。只返回翻译。'
};

export interface CueData { id: string; text: string; start: number; end: number; }
export interface ScoreResult { score: number; accuracy: number; completeness: number; fluency: number; words: Array<{ word: string; state: 'correct' | 'missing' | 'extra' }>; }
