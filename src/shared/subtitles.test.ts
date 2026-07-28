import { describe, expect, it } from 'vitest';
import { completeSentence, isChineseTrack, joinSubtitleFragments, splitBilingualLines } from './subtitles';

describe('subtitle helpers', () => {
  it('joins adjacent cue fragments into one complete sentence', () => {
    const cues = [
      { text: 'Welcome to', startTime: 0, endTime: 1 },
      { text: 'ClipLingo.', startTime: 1, endTime: 2 },
      { text: 'Let us begin.', startTime: 3, endTime: 4 }
    ];
    expect(completeSentence(cues, 0)).toEqual({ text: 'Welcome to ClipLingo.', start: 0, end: 2 });
    expect(completeSentence(cues, 1)).toEqual({ text: 'Welcome to ClipLingo.', start: 0, end: 2 });
  });

  it('does not cross a long subtitle gap', () => {
    const cues = [
      { text: 'An unfinished phrase', startTime: 0, endTime: 1 },
      { text: 'A new scene.', startTime: 4, endTime: 5 }
    ];
    expect(completeSentence(cues, 1).text).toBe('A new scene.');
  });

  it('deduplicates rolling captions', () => {
    expect(joinSubtitleFragments(['I really', 'I really like it.'])).toBe('I really like it.');
  });

  it('separates English and Chinese lines from a bilingual subtitle', () => {
    expect(splitBilingualLines(['How are you?', '你好吗？'])).toEqual({ source: 'How are you?', chinese: '你好吗？' });
  });

  it('recognizes common Chinese track metadata', () => {
    expect(isChineseTrack('zh-Hans', 'Chinese (Simplified)')).toBe(true);
    expect(isChineseTrack('en', 'English')).toBe(false);
  });
});
