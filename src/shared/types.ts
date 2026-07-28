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
  speechModel: string;
  speechVoiceId: string;
  speechSpeed: number;
  speechEmotion: string;
  translationMode: 'site-chrome' | 'minimax' | 'off';
  translationModel: string;
  autoCoach: boolean;
  targetLanguage: string;
  fontSize: number;
  opacity: number;
  pauseOnSentenceClick: boolean;
  loopCount: number;
  playbackRate: number;
  translationPrompt: string;
}

export const defaultSettings: Settings = {
  apiBaseUrl: 'https://api.minimaxi.com/v1',
  apiKey: '',
  model: 'MiniMax-M2.7',
  speechModel: 'speech-2.8-turbo',
  speechVoiceId: 'English_Graceful_Lady',
  speechSpeed: 0.9,
  speechEmotion: 'neutral',
  translationMode: 'site-chrome',
  translationModel: 'MiniMax-M2.7-highspeed',
  autoCoach: true,
  targetLanguage: '简体中文',
  fontSize: 22,
  opacity: 82,
  pauseOnSentenceClick: true,
  loopCount: 0,
  playbackRate: 1,
  translationPrompt: '你是英语学习助手。结合上下文，将英文字幕自然、准确地翻译为简体中文。只返回翻译。'
};

export interface CueData { id: string; text: string; start: number; end: number; }
export interface SpeechMetrics {
  durationRatio: number;
  pauseRatio: number;
  pitchVariation: number;
  energyVariation: number;
}

export interface ScoreResult {
  score: number;
  accuracy: number;
  completeness: number;
  fluency: number;
  rhythm: number;
  intonation: number;
  spokenText: string;
  metrics: SpeechMetrics;
  words: Array<{ word: string; state: 'correct' | 'missing' | 'extra' }>;
}
