import { describe, expect, it } from 'vitest';
import { normalizeWords, scoreSpeech } from './scoring';

describe('speech scoring', () => {
  it('normalizes punctuation and contractions', () => expect(normalizeWords("I didn't, know! ")).toEqual(['i', 'didnt', 'know']));
  it('scores an exact reading accurately', () => {
    const score = scoreSpeech('hello world', 'hello world');
    expect(score.accuracy).toBe(100);
    expect(score.completeness).toBe(100);
  });
  it('marks omitted words', () => expect(scoreSpeech('hello brave world', 'hello world').words.some(w => w.word === 'brave' && w.state === 'missing')).toBe(true));
  it('includes local rhythm and intonation metrics', () => {
    const score = scoreSpeech('hello world', 'hello world', { durationRatio: 1, pauseRatio: .14, pitchVariation: .2, energyVariation: .2 });
    expect(score.rhythm).toBe(100);
    expect(score.intonation).toBeGreaterThan(70);
  });
});
