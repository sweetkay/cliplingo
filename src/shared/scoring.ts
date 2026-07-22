import type { ScoreResult } from './types';

export function normalizeWords(text: string) {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function scoreSpeech(expectedText: string, spokenText: string, durationRatio = 1): ScoreResult {
  const expected = normalizeWords(expectedText);
  const spoken = normalizeWords(spokenText);
  const rows = expected.length + 1;
  const cols = spoken.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    dp[i][j] = expected[i - 1] === spoken[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  let i = expected.length, j = spoken.length;
  const states: ScoreResult['words'] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === spoken[j - 1]) { states.unshift({ word: expected[i - 1], state: 'correct' }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { states.unshift({ word: spoken[j - 1], state: 'extra' }); j--; }
    else { states.unshift({ word: expected[i - 1], state: 'missing' }); i--; }
  }
  const correct = states.filter(w => w.state === 'correct').length;
  const accuracy = spoken.length ? Math.round(correct / spoken.length * 100) : 0;
  const completeness = expected.length ? Math.round(correct / expected.length * 100) : 0;
  const fluency = Math.round(Math.max(0, Math.min(100, 100 - Math.abs(1 - durationRatio) * 65)));
  return { accuracy, completeness, fluency, score: Math.round(accuracy * .45 + completeness * .35 + fluency * .2), words: states };
}
