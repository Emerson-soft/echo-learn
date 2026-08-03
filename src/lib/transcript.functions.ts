import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildPhrases, type Phrase } from "./shadowing";

type Json3 = {
  events?: {
    tStartMs?: number;
    dDurationMs?: number;
    segs?: { utf8?: string }[];
  }[];
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

type Track = { baseUrl: string; languageCode?: string; kind?: string };

async function fromWatchPage(videoId: string): Promise<Track[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: {
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      cookie: "CONSENT=YES+cb; SOCS=CAI",
    },
    redirect: "follow",
  });
  if (!res.ok) return [];
  const html = await res.text();
  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) return [];
  try {
    return JSON.parse((match[1] ?? "[]").replace(/\\u0026/g, "&")) as Track[];
  } catch {
    return [];
  }
}

async function fromInnertube(videoId: string, client: Record<string, unknown>): Promise<Track[]> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ videoId, context: { client } }),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
  } | null;
  return json?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

async function fetchCaptionTracks(videoId: string): Promise<Track[]> {
  const strategies = [
    () => fromWatchPage(videoId),
    () =>
      fromInnertube(videoId, {
        clientName: "ANDROID",
        clientVersion: "19.09.37",
        androidSdkVersion: 30,
        hl: "en",
      }),
    () =>
      fromInnertube(videoId, {
        clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
        clientVersion: "2.0",
        hl: "en",
      }),
  ];
  for (const run of strategies) {
    try {
      const tracks = await run();
      if (tracks.length) return tracks;
    } catch {
      // try the next strategy
    }
  }
  return [];
}

export const getTranscript = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ videoId: z.string().min(5) }).parse(data))
  .handler(async ({ data }): Promise<{ phrases: Phrase[]; language: string | null }> => {
    const tracks = await fetchCaptionTracks(data.videoId);
    if (!tracks.length) return { phrases: [], language: null };

    const preferred =
      tracks.find((t) => t.languageCode?.startsWith("en") && !t.kind) ??
      tracks.find((t) => t.languageCode?.startsWith("en")) ??
      tracks[0];
    if (!preferred) return { phrases: [], language: null };

    const url = `${preferred.baseUrl}${preferred.baseUrl.includes("fmt=") ? "" : "&fmt=json3"}`;
    const capRes = await fetch(url, { headers: { "user-agent": UA } });
    if (!capRes.ok) return { phrases: [], language: preferred.languageCode ?? null };

    const json = (await capRes.json().catch(() => null)) as Json3 | null;
    const cues = (json?.events ?? [])
      .map((e) => ({
        start: (e.tStartMs ?? 0) / 1000,
        duration: (e.dDurationMs ?? 0) / 1000,
        text: (e.segs ?? []).map((s) => s.utf8 ?? "").join(""),
      }))
      .filter((c) => c.text.trim() && c.text.trim() !== "\n");

    return { phrases: buildPhrases(cues), language: preferred.languageCode ?? null };
  });
