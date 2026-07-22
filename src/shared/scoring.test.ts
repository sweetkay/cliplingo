import { describe, expect, it } from 'vitest';
import { normalizeWords, scoreSpeech } from './scoring';

describe('speech scoring', () => {
  it('normalizes punctuation and contractions', () => expect(normalizeWords("I didn't, know! ")).toEqual(['i', 'didnt', 'know']));
  it('scores an exact reading', () => expect(scoreSpeech('hello world', 'hello world').score).toBe(100));
  it('marks omitted words', () => expect(scoreSpeech('hello brave world', 'hello world').words.some(w => w.word === 'brave' && w.state === 'missing')).toBe(true));
});
