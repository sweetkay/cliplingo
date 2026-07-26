import type { ScoreResult, SpeechMetrics } from './types';

export function normalizeWords(text: string) {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function scoreSpeech(expectedText: string, spokenText: string, metrics: Partial<SpeechMetrics> | number = {}): ScoreResult {
  const resolved: SpeechMetrics = typeof metrics === 'number'
    ? { durationRatio: metrics, pauseRatio: .12, pitchVariation: .18, energyVariation: .16 }
    : {
        durationRatio: metrics.durationRatio ?? 1,
        pauseRatio: metrics.pauseRatio ?? .12,
        pitchVariation: metrics.pitchVariation ?? .18,
        energyVariation: metrics.energyVariation ?? .16
      };
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
  const paceScore = 100 - Math.abs(1 - resolved.durationRatio) * 65;
  const pauseScore = 100 - Math.abs(.14 - resolved.pauseRatio) * 220;
  const fluency = clamp(Math.round(paceScore * .7 + pauseScore * .3));
  const rhythm = clamp(Math.round(paceScore * .55 + pauseScore * .45));
  const pitchScore = Math.min(100, resolved.pitchVariation * 380);
  const energyScore = Math.min(100, resolved.energyVariation * 420);
  const intonation = clamp(Math.round(pitchScore * .65 + energyScore * .35));
  const score = Math.round(accuracy * .38 + completeness * .27 + fluency * .15 + rhythm * .1 + intonation * .1);
  return { accuracy, completeness, fluency, rhythm, intonation, score, spokenText, metrics: resolved, words: states };
}

function clamp(value: number) { return Math.max(0, Math.min(100, value)); }
