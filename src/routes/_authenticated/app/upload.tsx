import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UploadCloud, Link2, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { useActiveBrandId } from "@/lib/use-active-brand";

export const Route = createFileRoute("/_authenticated/app/upload")({
  component: UploadPage,
});

function UploadPage() {
  const [activeBrandId] = useActiveBrandId();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");

  const foldersQ = useQuery({
    queryKey: ["folders", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase.from("folders").select("*").eq("brand_id", activeBrandId!).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function createFolder() {
    if (!activeBrandId) return toast.error("Bitte zuerst einen Brand wählen");
    const name = window.prompt("Ordnername")?.trim();
    if (!name) return;
    const { data, error } = await supabase.from("folders").insert({
      user_id: user.id, brand_id: activeBrandId, name,
    }).select().single();
    if (error) return toast.error(error.message);
    setFolderId(data.id);
    foldersQ.refetch();
  }


  async function handleFile(file: File) {
    setBusy(true);
    setProgress(0);
    try {
      const key = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("raw-videos").upload(key, file, {
        contentType: file.type || "video/mp4",
        upsert: false,
      });
      if (upErr) throw upErr;
      setProgress(80);
      const duration = await probeDuration(file).catch(() => null);
      const { data: row, error: dbErr } = await supabase.from("raw_videos").insert({
        user_id: user.id,
        brand_id: activeBrandId,
        folder_id: folderId || null,
        platform: platform || null,
        title: title || file.name,
        storage_path: key,
        size_bytes: file.size,
        duration_s: duration,
      }).select().single();
      if (dbErr) throw dbErr;
      setProgress(100);
      toast.success("Upload fertig");
      navigate({ to: "/app/video/$id", params: { id: row.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function handleUrl() {
    if (!urlInput.trim()) return;
    setBusy(true);
    try {
      const { data: row, error } = await supabase.from("raw_videos").insert({
        user_id: user.id,
        brand_id: activeBrandId,
        folder_id: folderId || null,
        platform: platform || null,
        title: title || urlInput,
        source_url: urlInput,
      }).select().single();
      if (error) throw error;
      toast.success("Video-Link gespeichert");
      navigate({ to: "/app/video/$id", params: { id: row.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Upload</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Neues Video hinzufügen</h1>
        <p className="mt-2 text-sm text-muted-foreground">Datei hochladen oder Link einfügen. Max 500 MB pro Datei.</p>
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel (optional)" className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />

      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-border bg-card/50 p-12 text-center transition hover:border-primary/60">
        <UploadCloud className="mx-auto h-10 w-10 text-primary" />
        <div className="mt-3 text-sm font-medium">Datei hier fallen lassen oder klicken</div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">MP4 · MOV · WEBM · MKV</div>
        <input type="file" accept="video/*" disabled={busy} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        {busy && progress > 0 && (
          <div className="mx-auto mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-background">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </label>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Link2 className="h-4 w-4 text-accent" /> Oder per Link</div>
        <div className="flex gap-2">
          <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://…" className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
          <button onClick={handleUrl} disabled={busy || !urlInput} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">Speichern</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Für YouTube/TikTok-URLs speichern wir den Link; das Herunterladen und Schneiden erfolgt beim Öffnen des Videos.</p>
      </div>
    </div>
  );
}

function probeDuration(file: File): Promise<number> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); };
    v.onerror = () => rej(new Error("probe failed"));
    v.src = URL.createObjectURL(file);
  });
}
