import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UploadCloud, Link2, FolderPlus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useActiveBrandId, useBrands, useCreateBrand } from "@/lib/use-active-brand";

export const Route = createFileRoute("/_authenticated/app/upload")({
  component: UploadPage,
});

function UploadPage() {
  const [activeBrandId, setActiveBrandId] = useActiveBrandId();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const [newBrandName, setNewBrandName] = useState("");

  const brandsQ = useBrands(user.id);
  const brands = brandsQ.data ?? [];
  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;
  const createBrand = useCreateBrand(user.id);

  const foldersQ = useQuery({
    queryKey: ["folders", user.id, activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase.from("folders").select("*").eq("brand_id", activeBrandId!).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function submitNewBrand() {
    const name = newBrandName.trim();
    if (!name) return;
    try {
      const b = await createBrand(name);
      setActiveBrandId(b.id);
      setNewBrandName("");
      toast.success(`Profil „${b.name}" erstellt`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Konnte Profil nicht anlegen");
    }
  }

  async function createFolder() {
    if (!activeBrand) return;
    const name = window.prompt("Ordnername")?.trim();
    if (!name) return;
    const { data, error } = await supabase.from("folders").insert({
      user_id: user.id, brand_id: activeBrand.id, name,
    }).select().single();
    if (error) return toast.error(error.message);
    setFolderId(data.id);
    foldersQ.refetch();
  }

  async function handleFile(file: File) {
    if (!activeBrand) { toast.error("Bitte zuerst ein Profil wählen"); return; }
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
        brand_id: activeBrand.id,
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
    if (!activeBrand) { toast.error("Bitte zuerst ein Profil wählen"); return; }
    if (!urlInput.trim()) return;
    setBusy(true);
    try {
      const { data: row, error } = await supabase.from("raw_videos").insert({
        user_id: user.id,
        brand_id: activeBrand.id,
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

  // Profil-Gate: jedes Video MUSS zu einem Profil gehoeren
  if (!activeBrand) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <p className="text-[13px] font-semibold text-muted-foreground">Upload</p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Zuerst ein Profil wählen</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Jedes Video gehört zu einem Profil, so bleiben Videos, Kanäle und Upload-Zeitpläne pro Profil komplett getrennt.
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-[11px] border border-warning/30 bg-warning/15 p-3 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>Kein Profil aktiv. Wähle ein bestehendes oder lege ein neues an.</span>
        </div>

        {brands.length > 0 && (
          <div className="rounded-[18px] border border-border bg-card p-6">
            <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Vorhandene Profile</div>
            <div className="flex flex-wrap gap-2">
              {brands.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setActiveBrandId(b.id)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: b.color }} /> {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-[18px] border border-border bg-card p-6">
          <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Neues Profil anlegen</div>
          <div className="flex gap-2">
            <input
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitNewBrand()}
              placeholder="z. B. Meine Cafe-Marke"
              className="h-11 flex-1 rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
            />
            <button onClick={submitNewBrand} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]">Anlegen</button>
          </div>
        </div>

        <Link to="/app" className="inline-block text-[13px] text-accent hover:underline">← zum Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-[13px] font-semibold text-muted-foreground">Upload · Profil {activeBrand.name}</p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Neues Video hinzufügen</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">Datei hochladen oder Link einfügen. Max 500 MB pro Datei.</p>
        <button onClick={() => setActiveBrandId(null)} className="mt-2 text-[13px] text-accent hover:underline">
          Profil wechseln
        </button>
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel (optional)" className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[13px] font-semibold text-foreground">Ordner</label>
          <div className="flex gap-2">
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="h-11 flex-1 rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/60">
              <option value="">Kein Ordner</option>
              {(foldersQ.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button type="button" onClick={createFolder} className="inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-secondary px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">
              <FolderPlus className="h-4 w-4" /> Neu
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-semibold text-foreground">Ziel-Plattform (optional)</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/60">
            <option value="">Keine</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="x">X (Twitter)</option>
          </select>
        </div>
      </div>

      <label className="block cursor-pointer rounded-[18px] border border-dashed border-border bg-card p-12 text-center transition-colors hover:border-primary/60">
        <UploadCloud className="mx-auto h-10 w-10 text-primary" />
        <div className="mt-3 text-[15px] font-semibold">Datei hier fallen lassen oder klicken</div>
        <div className="mt-1 text-[13px] text-muted-foreground">MP4 · MOV · WEBM · MKV</div>
        <input type="file" accept="video/*" disabled={busy} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        {busy && progress > 0 && (
          <div className="mx-auto mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </label>

      <div className="rounded-[18px] border border-border bg-card p-6">
        <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Link2 className="h-4 w-4 text-primary" /> Oder per Link</div>
        <div className="flex gap-2">
          <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://…" className="h-11 flex-1 rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60" />
          <button onClick={handleUrl} disabled={busy || !urlInput} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]">Speichern</button>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">Für YouTube/TikTok-URLs speichern wir den Link; das Herunterladen und Schneiden erfolgt beim Öffnen des Videos.</p>
      </div>
    </div>
  );
}

function probeDuration(file: File): Promise<number> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(url); };
    v.onerror = () => { URL.revokeObjectURL(url); rej(new Error("probe failed")); };
    v.src = url;
  });
}
