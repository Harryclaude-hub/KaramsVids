import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Mic, Square, Sparkles, Wrench, Loader2, Wand2, Link2, UploadCloud } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeStyleReference } from "@/lib/style.functions";

type Props = {
  jobId: string;
  userId: string;
  initialMessages: UIMessage[];
  styleReference: Record<string, unknown> | null;
  onChanged: () => void;
};

export function EditorChat({ jobId, userId, initialMessages, styleReference, onChanged }: Props) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => (token ? { Authorization: `Bearer ${token}` } : {}),
        body: () => ({ jobId }),
      }),
    [token, jobId],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: jobId,
    messages: initialMessages,
    transport,
    onFinish: () => onChanged(),
    onError: (e) => toast.error(e.message ?? "Chat-Fehler"),
  });

  useEffect(() => { setMessages(initialMessages); }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => { inputRef.current?.focus(); }, [jobId]);

  async function send() {
    const text = input.trim();
    if (!text || !token) return;
    setInput("");
    await sendMessage({ text });
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 2048) { toast.error("Aufnahme zu kurz"); return; }
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, "recording");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          const raw = await res.text();
          if (!res.ok) throw new Error(raw);
          const j = JSON.parse(raw) as { text?: string };
          if (j.text) {
            setInput((cur) => (cur ? cur + " " : "") + j.text!.trim());
            inputRef.current?.focus();
          } else {
            toast.error("Kein Transkript erhalten");
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Transkription fehlgeschlagen");
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mikrofon-Zugriff verweigert");
    }
  }
  function stopRec() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  const isLoading = status === "submitted" || status === "streaming";
  const suggestions = [
    "Alle Clips auf 20 Sekunden kürzen",
    "Format auf 9:16 setzen",
    "Untertitel für alle Clips erzeugen",
    "Clip 1 an Sekunde 5 splitten",
  ];

  return (
    <div className="flex h-[720px] flex-col rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">KI-Editor Chat</div>
        <div className="ml-auto font-mono text-[10px] uppercase text-muted-foreground">gpt-5.5 · tools</div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Sag mir was du am Video ändern möchtest — z. B. "kürze alle Clips auf 15 Sekunden", "füge einen Clip von 30 bis 45 hinzu", oder "kopiere den Stil vom Referenzvideo".
            <div className="mt-3 flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button key={s} onClick={() => setInput(s)} className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> KI arbeitet…
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error.message}</div>}
      </div>

      <StyleReferencePanel jobId={jobId} userId={userId} styleReference={styleReference} onChanged={onChanged} />

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={recording ? "Aufnahme läuft…" : transcribing ? "Transkribiere…" : "Was soll die KI machen?"}
            disabled={isLoading || recording || transcribing}
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-70"
          />
          <div className="flex flex-col gap-1">
            {recording ? (
              <button onClick={stopRec} className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground animate-pulse">
                <Square className="h-3 w-3" /> Stop
              </button>
            ) : (
              <button onClick={startRec} disabled={transcribing || isLoading} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary disabled:opacity-60" title="Sprich rein — wird transkribiert">
                {transcribing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3" />} Mic
              </button>
            )}
            <button onClick={send} disabled={!input.trim() || isLoading || !token} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              <Send className="h-3 w-3" /> Senden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: UIMessage }) {
  if (m.role === "user") {
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
        {text}
      </div>
    );
  }
  return (
    <div className="max-w-[92%] space-y-2">
      {m.parts.map((p, i) => {
        if (p.type === "text") {
          return (
            <div key={i} className="prose prose-sm prose-invert max-w-none text-sm text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
            </div>
          );
        }
        if (p.type.startsWith("tool-")) {
          const tp = p as unknown as { type: string; state: string; input?: unknown; output?: unknown; errorText?: string };
          const name = tp.type.replace(/^tool-/, "");
          const running = tp.state === "input-streaming" || tp.state === "input-available";
          const ok = tp.state === "output-available";
          return (
            <div key={i} className="rounded-md border border-border bg-background p-2 font-mono text-[11px]">
              <div className="flex items-center gap-2">
                {running ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : <Wrench className="h-3 w-3 text-primary" />}
                <span className="font-semibold">{name}</span>
                <span className="ml-auto text-[10px] uppercase text-muted-foreground">{tp.state}</span>
              </div>
              {tp.input != null && Object.keys(tp.input as object).length > 0 && (
                <pre className="mt-1 overflow-x-auto text-[10px] text-muted-foreground">{JSON.stringify(tp.input, null, 2)}</pre>
              )}
              {ok && (
                <pre className="mt-1 overflow-x-auto text-[10px] text-primary">{JSON.stringify(tp.output, null, 2)}</pre>
              )}
              {tp.errorText && <div className="mt-1 text-destructive">{tp.errorText}</div>}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function StyleReferencePanel({ jobId, userId, styleReference, onChanged }: { jobId: string; userId: string; styleReference: Record<string, unknown> | null; onChanged: () => void }) {
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const analyze = useServerFn(analyzeStyleReference);

  async function run(payload: { sourceUrl?: string; storagePath?: string; notes?: string }) {
    setBusy(true);
    try {
      await analyze({ data: { jobId, ...payload } });
      toast.success("Referenz-Stil analysiert — jetzt: „wende Referenz-Stil an" in den Chat");
      onChanged();
      setUrl(""); setNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analyse fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    if (file.size > 100 * 1024 * 1024) { toast.error("Max 100 MB für Referenzvideos"); return; }
    setBusy(true);
    try {
      const key = `${userId}/refs/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("raw-videos").upload(key, file, { contentType: file.type || "video/mp4" });
      if (error) throw error;
      await run({ storagePath: key, notes });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
      setBusy(false);
    }
  }

  return (
    <details className="border-t border-border bg-background/40 px-4 py-3 text-xs">
      <summary className="cursor-pointer select-none font-medium">
        <span className="inline-flex items-center gap-2"><Wand2 className="h-3 w-3 text-accent" /> Referenz-Stil kopieren {styleReference && <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">aktiv</span>}</span>
      </summary>
      <div className="mt-3 space-y-2">
        <div className="text-[11px] text-muted-foreground">
          Gib ein Referenzvideo (Link oder Datei). Die KI leitet Aspect, Cut-Frequenz, Untertitel-Stil und mehr ab — dann sag im Chat „wende den Stil an".
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notiz (optional): 'Kurze UGC-Reels mit Karaoke-Captions'" className="w-full rounded-md border border-border bg-background px-2 py-1.5 outline-none focus:border-primary" />
        <div className="flex gap-2">
          <div className="flex flex-1 gap-1">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tiktok.com/…" className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 outline-none focus:border-primary" />
            <button disabled={!url || busy} onClick={() => run({ sourceUrl: url, notes })} className="inline-flex items-center gap-1 rounded-md border border-primary px-2 text-primary hover:bg-primary/10 disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Link
            </button>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1.5 hover:bg-secondary">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />} Datei
            <input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={busy} />
          </label>
        </div>
        {styleReference && (
          <div className="rounded-md border border-border bg-card p-2 font-mono text-[10px] text-muted-foreground">
            {(["aspect", "avg_clip_length_s", "cut_frequency", "caption_style", "color_grade", "audio_style"] as const).map((k) => (
              styleReference[k] != null && <div key={k}><span className="text-foreground">{k}:</span> {String(styleReference[k])}</div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
