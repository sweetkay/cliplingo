export interface TextCueLike {
  text: string;
  startTime: number;
  endTime: number;
}

export interface CompleteCue {
  text: string;
  start: number;
  end: number;
}

const sentenceEnd = /[.!?。！？]["'’”）)\]]*\s*$/;

export function cleanSubtitle(text: string) {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function hasChinese(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

export function isChineseTrack(language = '', label = '') {
  const metadata = `${language} ${label}`.toLowerCase();
  return /(^|[\s_-])zh(?:[\s_-]|$)|chinese|中文|简体|繁体|汉语|漢語/.test(metadata);
}

export function isEnglishTrack(language = '', label = '') {
  const metadata = `${language} ${label}`.toLowerCase();
  return /(^|[\s_-])en(?:[\s_-]|$)|english|英语|英語/.test(metadata);
}

export function completeSentence(cues: TextCueLike[], index: number, maxCues = 8): CompleteCue {
  const current = cues[index];
  if (!current) return { text: '', start: 0, end: 0 };

  let start = index;
  let end = index;
  while (
    start > 0 &&
    end - start + 1 < maxCues &&
    !sentenceEnd.test(cleanSubtitle(cues[start - 1].text)) &&
    cues[start].startTime - cues[start - 1].endTime <= 1.5
  ) start--;

  while (
    end + 1 < cues.length &&
    end - start + 1 < maxCues &&
    !sentenceEnd.test(cleanSubtitle(cues[end].text)) &&
    cues[end + 1].startTime - cues[end].endTime <= 1.5
  ) end++;

  return {
    text: joinSubtitleFragments(cues.slice(start, end + 1).map(cue => cue.text)),
    start: cues[start].startTime,
    end: cues[end].endTime
  };
}

export function joinSubtitleFragments(fragments: string[]) {
  const result: string[] = [];
  for (const raw of fragments) {
    const fragment = cleanSubtitle(raw);
    if (!fragment || result[result.length - 1] === fragment) continue;
    const previous = result[result.length - 1] || '';
    if (previous && fragment.startsWith(previous)) result[result.length - 1] = fragment;
    else if (!previous.endsWith(fragment)) result.push(fragment);
  }
  return cleanSubtitle(result.join(' '));
}

export function splitBilingualLines(values: string[]) {
  const lines = values.flatMap(value => value.split(/\r?\n/)).map(cleanSubtitle).filter(Boolean);
  const chinese = joinSubtitleFragments(lines.filter(hasChinese));
  const source = joinSubtitleFragments(lines.filter(line => !hasChinese(line) && /[a-z]/i.test(line)));
  return { source, chinese };
}
