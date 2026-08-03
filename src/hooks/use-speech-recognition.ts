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

export function useSpeechRecognition(lang = "en-US") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const finalRef = useRef("");
  const doneRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    setSupported(Boolean(getCtor()));
    return () => recRef.current?.abort();
  }, []);

  const start = useCallback(
    (onDone?: (text: string) => void) => {
      const Ctor = getCtor();
      if (!Ctor) {
        setError("Seu navegador não suporta reconhecimento de voz. Use o Chrome.");
        return;
      }
      recRef.current?.abort();
      setError(null);
      setTranscript("");
      finalRef.current = "";
      doneRef.current = onDone ?? null;

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = false;
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
      };
      rec.onerror = (event: unknown) => {
        const code = (event as { error?: string }).error;
        setError(
          code === "not-allowed"
            ? "Permissão do microfone negada."
            : code === "no-speech"
              ? "Não ouvi nada. Tente falar mais perto do microfone."
              : "Erro ao capturar áudio.",
        );
        setListening(false);
      };
      rec.onend = () => {
        setListening(false);
        doneRef.current?.(finalRef.current);
      };
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        setError("Não foi possível iniciar a gravação.");
      }
    },
    [lang],
  );

  const stop = useCallback(() => recRef.current?.stop(), []);

  return { supported, listening, transcript, error, start, stop };
}
