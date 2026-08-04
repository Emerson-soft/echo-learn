import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

function getCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"]) as
    | (new () => RecognitionLike)
    | null;
}

/** Silence (ms) after the last recognized word before we finish automatically. */
const SILENCE_MS = 3500;
/** Hard limit (ms) for a single capture session. */
const MAX_MS = 30000;

export function useSpeechRecognition(lang = "en-US") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const finalRef = useRef("");
  const doneRef = useRef<((text: string) => void) | null>(null);
  const activeRef = useRef(false);
  const silenceRef = useRef<number | null>(null);
  const maxRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (silenceRef.current) window.clearTimeout(silenceRef.current);
    if (maxRef.current) window.clearTimeout(maxRef.current);
    silenceRef.current = null;
    maxRef.current = null;
  }, []);

  useEffect(() => {
    setSupported(Boolean(getCtor()));
    return () => {
      activeRef.current = false;
      clearTimers();
      recRef.current?.abort();
    };
  }, [clearTimers]);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearTimers();
    recRef.current?.stop();
    setListening(false);
    doneRef.current?.(finalRef.current);
    doneRef.current = null;
  }, [clearTimers]);

  const start = useCallback(
    (onDone?: (text: string) => void) => {
      const Ctor = getCtor();
      if (!Ctor) {
        setError("Seu navegador não suporta reconhecimento de voz. Use o Chrome.");
        return;
      }
      activeRef.current = false;
      clearTimers();
      recRef.current?.abort();
      setError(null);
      setTranscript("");
      finalRef.current = "";
      doneRef.current = onDone ?? null;
      activeRef.current = true;

      const armSilence = () => {
        if (silenceRef.current) window.clearTimeout(silenceRef.current);
        silenceRef.current = window.setTimeout(finish, SILENCE_MS);
      };

      const rec = new Ctor();
      rec.lang = lang;
      // Continuous keeps the session open through natural pauses instead of
      // cutting off after the first fragment of speech.
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (event: unknown) => {
        const e = event as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
        let text = "";
        for (let i = 0; i < e.results.length; i++) {
          const alt = e.results[i]?.[0];
          if (alt) text += ` ${alt.transcript}`;
        }
        finalRef.current = text.trim();
        setTranscript(finalRef.current);
        armSilence();
      };
      rec.onerror = (event: unknown) => {
        const code = (event as { error?: string }).error;
        // Silence-related errors shouldn't kill the session: just restart.
        if (code === "no-speech" || code === "aborted") return;
        activeRef.current = false;
        clearTimers();
        setError(
          code === "not-allowed"
            ? "Permissão do microfone negada."
            : "Erro ao capturar áudio.",
        );
        setListening(false);
      };
      rec.onend = () => {
        // Chrome ends the session on its own; while the user is still
        // recording we restart it so nothing gets clipped.
        if (activeRef.current) {
          try {
            rec.start();
            return;
          } catch {
            /* fall through to finishing */
          }
          activeRef.current = false;
          clearTimers();
          setListening(false);
          doneRef.current?.(finalRef.current);
          doneRef.current = null;
        }
      };
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
        armSilence();
        maxRef.current = window.setTimeout(finish, MAX_MS);
      } catch {
        activeRef.current = false;
        setError("Não foi possível iniciar a gravação.");
      }
    },
    [lang, clearTimers, finish],
  );

  return { supported, listening, transcript, error, start, stop: finish };
}
