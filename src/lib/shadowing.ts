export type Phrase = {
  index: number;
  start: number;
  end: number;
  text: string;
};

export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((p) => ["embed", "shorts", "live"].includes(p));
    if (marker >= 0 && parts[marker + 1]) {
      const id = parts[marker + 1];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance over word arrays. */
function wordDistance(a: string[], b: string[]): number {
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export type ScoreResult = {
  score: number;
  matched: boolean[];
  spokenWords: string[];
};

/** Compares what the user said with the target phrase and returns 0-100. */
export function scoreSpeech(target: string, spoken: string): ScoreResult {
  const t = normalizeWords(target);
  const s = normalizeWords(spoken);
  if (t.length === 0) return { score: 0, matched: [], spokenWords: s };
  const spokenSet = new Set(s);
  const matched = t.map((w) => spokenSet.has(w));
  const distance = wordDistance(t, s);
  const seq = Math.max(0, 1 - distance / Math.max(t.length, s.length || 1));
  const coverage = matched.filter(Boolean).length / t.length;
  const score = Math.round((seq * 0.6 + coverage * 0.4) * 100);
  return { score: Math.max(0, Math.min(100, score)), matched, spokenWords: s };
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Perfeito";
  if (score >= 75) return "Muito bom";
  if (score >= 55) return "Quase lá";
  if (score >= 30) return "Precisa treinar";
  return "Tente de novo";
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Splits raw caption cues into speakable phrases. */
export function buildPhrases(
  cues: { start: number; duration: number; text: string }[],
): Phrase[] {
  const phrases: Phrase[] = [];
  let buffer = "";
  let start = 0;
  let end = 0;
  let open = false;

  const flush = () => {
    const text = buffer.replace(/\s+/g, " ").trim();
    if (text) {
      phrases.push({ index: phrases.length, start, end: Math.max(end, start + 0.8), text });
    }
    buffer = "";
    open = false;
  };

  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!open) {
      start = cue.start;
      open = true;
    }
    buffer = buffer ? `${buffer} ${text}` : text;
    end = cue.start + (cue.duration || 2);
    const wordCount = normalizeWords(buffer).length;
    if (/[.!?]"?$/.test(buffer) || wordCount >= 16) flush();
  }
  flush();
  return phrases;
}

/** Fallback: turn pasted text into phrases spread over the video timeline. */
export function phrasesFromText(text: string, totalSeconds: number): Phrase[] {
  const chunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!chunks.length) return [];
  const step = totalSeconds > 0 ? totalSeconds / chunks.length : 4;
  return chunks.map((t, i) => ({
    index: i,
    start: i * step,
    end: (i + 1) * step,
    text: t,
  }));
}
