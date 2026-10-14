import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mic,
  Play,
  Repeat,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useYouTubePlayer } from "@/hooks/use-youtube-player";
import {
  formatTime,
  parseYouTubeId,
  phrasesFromText,
  phrasesFromTimedText,
  scoreLabel,
  scoreSpeech,
  type Phrase,
} from "@/lib/shadowing";
import { getTranscript } from "@/lib/transcript.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shadow Loop — Shadowing com vídeos do YouTube" },
      {
        name: "description",
        content:
          "Cole um link do YouTube, repita frase por frase com legenda opcional e receba uma nota da sua pronúncia em inglês.",
      },
      { property: "og:title", content: "Shadow Loop — Shadowing com vídeos do YouTube" },
      {
        property: "og:description",
        content: "Loop de frases, legenda com toggle e nota de pronúncia pelo microfone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShadowingApp,
});

const RATES = [0.5, 0.75, 1];
const LANGUAGES = [
  { code: "en-US", label: "Inglês" },
  { code: "pt-BR", label: "Português" },
  { code: "es-ES", label: "Espanhol" },
  { code: "fr-FR", label: "Francês" },
  { code: "de-DE", label: "Alemão" },
  { code: "it-IT", label: "Italiano" },
  { code: "ja-JP", label: "Japonês" },
  { code: "ko-KR", label: "Coreano" },
  { code: "zh-CN", label: "Chinês" },
];
/** Extra seconds kept after the phrase end so the last words are never cut. */
const TAIL_PAD = 0.7;

function ShadowingApp() {
  const loadTranscript = useServerFn(getTranscript);
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(1);
  const [manual, setManual] = useState("");
  const [needManual, setNeedManual] = useState(false);
  const [result, setResult] = useState<{ score: number; matched: boolean[] } | null>(null);

  const { containerRef, ready, api } = useYouTubePlayer(videoId);
  const speech = useSpeechRecognition("en-US");
  const listRef = useRef<HTMLDivElement | null>(null);

  const phrase = phrases[current] ?? null;

  // Keeps the video inside the boundaries of the selected phrase.
  useEffect(() => {
    if (!ready || !phrase) return;
    const limit = phrase.end + TAIL_PAD;
    const id = window.setInterval(() => {
      const player = api();
      if (!player) return;
      const t = player.getCurrentTime();
      if (t >= limit) {
        if (loop) {
          player.seekTo(phrase.start, true);
        } else {
          player.pauseVideo();
        }
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [api, ready, phrase, loop]);

  useEffect(() => {
    api()?.setPlaybackRate(rate);
  }, [api, rate, ready]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-phrase="${current}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  async function handleLoad(event: React.FormEvent) {
    event.preventDefault();
    const id = parseYouTubeId(url);
    if (!id) {
      setNotice("Link inválido. Cole a URL completa de um vídeo do YouTube.");
      return;
    }
    setLoading(true);
    setNotice(null);
    setNeedManual(false);
    setPhrases([]);
    setResult(null);
    setCurrent(0);
    setVideoId(id);
    try {
      const data = await loadTranscript({ data: { videoId: id } });
      if (data.phrases.length) {
        setPhrases(data.phrases);
      } else {
        setNeedManual(true);
        setNotice(
          "Não achei legendas automáticas nesse vídeo. Cole o texto da fala abaixo para gerar as frases.",
        );
      }
    } catch {
      setNeedManual(true);
      setNotice("Não consegui buscar as legendas. Você pode colar o texto manualmente abaixo.");
    } finally {
      setLoading(false);
    }
  }

  function applyManual() {
    const duration = api()?.getDuration() ?? 0;
    const timed = phrasesFromTimedText(manual);
    const built = timed.length ? timed : phrasesFromText(manual, duration);
    if (!built.length) {
      setNotice("Cole ao menos uma frase.");
      return;
    }
    setPhrases(built);
    setCurrent(0);
    setNeedManual(false);
    setNotice(null);
  }

  function playPhrase(index = current) {
    const target = phrases[index];
    const player = api();
    if (!target || !player) return;
    setCurrent(index);
    setResult(null);
    player.seekTo(target.start, true);
    player.setPlaybackRate(rate);
    player.playVideo();
  }

  function go(delta: number) {
    const next = Math.min(Math.max(current + delta, 0), Math.max(phrases.length - 1, 0));
    playPhrase(next);
  }

  function toggleMic() {
    if (speech.listening) {
      speech.stop();
      return;
    }
    api()?.pauseVideo();
    setResult(null);
    speech.start((text) => {
      if (!phrase) return;
      const scored = scoreSpeech(phrase.text, text);
      setResult({ score: scored.score, matched: scored.matched });
    });
  }

  const targetWords = useMemo(() => (phrase ? phrase.text.split(/\s+/) : []), [phrase]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-3">
        <span className="w-fit rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Shadowing trainer
        </span>
        <h1 className="text-4xl font-bold sm:text-5xl">
          Fale junto, <span className="text-gradient">frase por frase</span>
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
          Cole um vídeo do YouTube em inglês. O app corta a fala em frases curtas para você repetir
          em loop, com legenda opcional e nota da sua pronúncia pelo microfone.
        </p>
      </header>

      <form onSubmit={handleLoad} className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="h-12 bg-surface text-base"
          aria-label="URL do vídeo do YouTube"
        />
        <Button type="submit" size="lg" className="h-12 px-6 font-semibold" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Play />}
          Carregar vídeo
        </Button>
      </form>

      {notice ? (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="panel overflow-hidden">
            <div className="aspect-video w-full bg-black">
              {videoId ? (
                <div ref={containerRef} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Seu vídeo aparece aqui
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 p-5">
              <div className="min-h-24 rounded-xl bg-surface-2 p-4 text-center">
                {phrase ? (
                  showSubtitle ? (
                    <p className="text-xl leading-relaxed font-semibold sm:text-2xl">
                      {targetWords.map((word, i) => (
                        <span
                          key={`${word}-${i}`}
                          className={
                            result
                              ? result.matched[i]
                                ? "text-primary"
                                : "text-destructive"
                              : undefined
                          }
                        >
                          {word}{" "}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="py-4 text-sm text-muted-foreground">
                      Legenda oculta — confie nos ouvidos.
                    </p>
                  )
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    Carregue um vídeo para começar o treino.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => go(-1)} disabled={!phrase}>
                  <ChevronLeft /> Anterior
                </Button>
                <Button onClick={() => playPhrase()} disabled={!phrase} className="font-semibold">
                  <Play /> Tocar frase
                </Button>
                <Button variant="secondary" onClick={() => go(1)} disabled={!phrase}>
                  Próxima <ChevronRight />
                </Button>
                <Button
                  variant={loop ? "default" : "secondary"}
                  onClick={() => setLoop((v) => !v)}
                  aria-pressed={loop}
                >
                  <Repeat /> Loop
                </Button>
                <Button
                  variant={showSubtitle ? "secondary" : "outline"}
                  onClick={() => setShowSubtitle((v) => !v)}
                  aria-pressed={showSubtitle}
                >
                  {showSubtitle ? <Captions /> : <CaptionsOff />}
                  {showSubtitle ? "Legenda ligada" : "Legenda desligada"}
                </Button>
                <div className="ml-auto flex items-center gap-1 rounded-lg bg-surface-2 p-1">
                  {RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRate(r)}
                      className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
                        rate === r
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {r}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={toggleMic}
                    disabled={!phrase || !speech.supported}
                    variant={speech.listening ? "destructive" : "default"}
                    className="font-semibold"
                  >
                    {speech.listening ? <Square /> : <Mic />}
                    {speech.listening ? "Parar e avaliar" : "Falar agora"}
                  </Button>
                  {result ? (
                    <div className="flex items-center gap-3">
                      <span className="font-display text-3xl font-bold text-primary">
                        {result.score}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        /100 · {scoreLabel(result.score)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {speech.listening ? "Ouvindo…" : "Repita a frase e receba sua nota."}
                    </span>
                  )}
                </div>
                {speech.transcript ? (
                  <p className="text-sm text-muted-foreground">
                    Você disse: <span className="text-foreground">“{speech.transcript}”</span>
                  </p>
                ) : null}
                {!speech.supported ? (
                  <p className="text-sm text-destructive">
                    Reconhecimento de voz indisponível neste navegador — use o Chrome.
                  </p>
                ) : null}
                {speech.error ? <p className="text-sm text-destructive">{speech.error}</p> : null}
              </div>
            </div>
          </div>

          <div className="panel flex flex-col gap-3 p-5">
            <h2 className="text-lg font-semibold">
              {needManual ? "Colar a transcrição" : "Usar sua própria transcrição"}
            </h2>
            <p className="text-sm text-muted-foreground">
              No YouTube, abra “Mostrar transcrição”, copie e cole aqui. Se o texto vier com
              tempos (0:12), as frases ficam sincronizadas com o vídeo.
            </p>
            <Textarea
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              rows={5}
              placeholder="0:03 Hello everyone, welcome back…"
              className="bg-surface-2"
            />
            <Button onClick={applyManual} className="w-fit font-semibold">
              Gerar frases
            </Button>
          </div>
        </div>

        <div className="panel flex max-h-[36rem] flex-col p-4">
          <div className="flex items-center justify-between px-1 pb-3">
            <h2 className="text-lg font-semibold">Frases</h2>
            <span className="text-sm text-muted-foreground">{phrases.length}</span>
          </div>
          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto pr-1">
            {phrases.length ? (
              phrases.map((p, i) => (
                <button
                  key={p.index}
                  data-phrase={i}
                  onClick={() => playPhrase(i)}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                    i === current
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="mb-1 block font-mono text-xs opacity-70">
                    {formatTime(p.start)}
                  </span>
                  {p.text}
                </button>
              ))
            ) : (
              <p className="px-1 text-sm text-muted-foreground">
                As frases do vídeo aparecem aqui depois de carregar a legenda.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
