// ============================================================
// Render-Provider-Registry (nur Server).
//
// Pro Bulk-Job (bzw. pro Render-Zeile) kann ein Provider gewählt
// werden. Alle Provider liefern ein einheitliches Statusobjekt
// (CreatomateRender-Form), damit die Bulk-Pipeline unverändert
// weiterarbeiten kann.
//
// Secrets:
//   CREATOMATE_API_KEY   — creatomate.com → Project Settings → API Key
//   SHOTSTACK_API_KEY    — shotstack.io → Dashboard → API Keys
//   JSON2VIDEO_API_KEY   — json2video.com → Account → API Key
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  buildCreatomateSource,
  type Aspect,
  type TemplateOverrides,
} from "@/lib/creatomate-templates";
import {
  creatomateConfigured,
  fetchRender as fetchCreatomate,
  pingCreatomate,
  submitRender as submitCreatomate,
  webhookUrl,
  type CreatomateRender,
} from "@/lib/creatomate.server";

export const RENDER_PROVIDER_IDS = ["creatomate", "shotstack", "json2video"] as const;
export type RenderProviderId = (typeof RENDER_PROVIDER_IDS)[number];

export function isRenderProviderId(v: unknown): v is RenderProviderId {
  return typeof v === "string" && (RENDER_PROVIDER_IDS as readonly string[]).includes(v);
}

export type RenderRequest = {
  rowId: string;
  templateId: string;
  overrides: TemplateOverrides;
  aspect: Aspect;
  videoUrl: string;
  startS: number;
  endS: number;
  captionsSrt: string | null;
  musicUrl: string | null;
  musicVolume: number;
  title: string | null;
};

export type RenderProvider = {
  id: RenderProviderId;
  label: string;
  /** Kann der Provider fertige Renders selbst zurückmelden? */
  supportsWebhook: boolean;
  keyName: string;
  docsUrl: string;
  note: string;
  configured(): boolean;
  ping(): Promise<{ ok: boolean; message: string }>;
  submit(req: RenderRequest): Promise<{ id: string }>;
  fetch(id: string): Promise<CreatomateRender>;
};

function aspectSize(aspect: Aspect) {
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  return { width: 1080, height: 1920 };
}

// ---------------- Creatomate ----------------

const creatomate: RenderProvider = {
  id: "creatomate",
  label: "Creatomate",
  supportsWebhook: true,
  keyName: "CREATOMATE_API_KEY",
  docsUrl: "https://creatomate.com/docs",
  note: "Volle Vorlagen: Karaoke-Untertitel, Musik-Ducking, Übergänge, Ken-Burns.",
  configured: () => creatomateConfigured(),
  ping: () => pingCreatomate(),
  async submit(req) {
    const source = buildCreatomateSource({
      templateId: req.templateId,
      overrides: req.overrides,
      aspect: req.aspect,
      videoUrl: req.videoUrl,
      startS: req.startS,
      endS: req.endS,
      captionsSrt: req.captionsSrt,
      captionsEnabled: true,
      musicUrl: req.musicUrl,
      hookText: null,
    });
    const r = await submitCreatomate(source, { metadata: req.rowId });
    return { id: r.id };
  },
  fetch: (id) => fetchCreatomate(id),
};

// ---------------- Shotstack ----------------

const SHOTSTACK_API = "https://api.shotstack.io/edit/v1";

function shotstackKey() {
  const k = process.env.SHOTSTACK_API_KEY;
  if (!k) throw new Error("SHOTSTACK_API_KEY fehlt — Key aus shotstack.io hinterlegen.");
  return k;
}

const shotstack: RenderProvider = {
  id: "shotstack",
  label: "Shotstack",
  supportsWebhook: false,
  keyName: "SHOTSTACK_API_KEY",
  docsUrl: "https://shotstack.io/docs/api/",
  note: "Sehr schnelle Massen-Renders; Untertitel/Musik werden vereinfacht abgebildet.",
  configured: () => !!process.env.SHOTSTACK_API_KEY,
  async ping() {
    if (!process.env.SHOTSTACK_API_KEY) return { ok: false, message: "Kein Shotstack-Key hinterlegt." };
    try {
      const res = await fetch(`${SHOTSTACK_API}/renders?limit=1`, {
        headers: { "x-api-key": shotstackKey() },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Shotstack-Key wurde abgelehnt (401/403)." };
      }
      if (!res.ok) return { ok: false, message: `Shotstack antwortete mit HTTP ${res.status}.` };
      return { ok: true, message: "Shotstack-Verbindung steht." };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Netzwerkfehler" };
    }
  },
  async submit(req) {
    const { width, height } = aspectSize(req.aspect);
    const length = Math.max(1, req.endS - req.startS);
    const tracks: any[] = [
      {
        clips: [
          {
            asset: { type: "video", src: req.videoUrl, trim: Math.max(0, req.startS) },
            start: 0,
            length,
            fit: "cover",
            transition: { in: "fade", out: "fade" },
          },
        ],
      },
    ];
    if (req.title) {
      tracks.unshift({
        clips: [
          {
            asset: {
              type: "title",
              text: req.title,
              style: "subtitle",
              position: "bottom",
            },
            start: 0,
            length: Math.min(length, 4),
          },
        ],
      });
    }
    const body = {
      timeline: {
        background: "#000000",
        ...(req.musicUrl
          ? { soundtrack: { src: req.musicUrl, effect: "fadeOut", volume: req.musicVolume } }
          : {}),
        tracks,
      },
      output: { format: "mp4", size: { width, height }, fps: 30 },
    };
    const res = await fetch(`${SHOTSTACK_API}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": shotstackKey() },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Shotstack ${res.status}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    const id = json?.response?.id;
    if (!id) throw new Error("Shotstack lieferte keine Render-ID");
    return { id };
  },
  async fetch(id) {
    const res = await fetch(`${SHOTSTACK_API}/render/${encodeURIComponent(id)}`, {
      headers: { "x-api-key": shotstackKey() },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Shotstack Status ${res.status}: ${text.slice(0, 300)}`);
    const r = JSON.parse(text)?.response ?? {};
    const map: Record<string, CreatomateRender["status"]> = {
      queued: "waiting",
      fetching: "waiting",
      rendering: "rendering",
      saving: "transcoding",
      done: "succeeded",
      failed: "failed",
    };
    return {
      id,
      status: map[r.status as string] ?? "rendering",
      url: r.url,
      snapshot_url: r.poster ?? r.thumbnail,
      error_message: r.error,
    };
  },
};

// ---------------- JSON2Video ----------------

const J2V_API = "https://api.json2video.com/v2";

function j2vKey() {
  const k = process.env.JSON2VIDEO_API_KEY;
  if (!k) throw new Error("JSON2VIDEO_API_KEY fehlt — Key aus json2video.com hinterlegen.");
  return k;
}

const json2video: RenderProvider = {
  id: "json2video",
  label: "JSON2Video",
  supportsWebhook: false,
  keyName: "JSON2VIDEO_API_KEY",
  docsUrl: "https://json2video.com/docs/",
  note: "Günstige Alternative für einfache Clips mit Musik und Text-Overlay.",
  configured: () => !!process.env.JSON2VIDEO_API_KEY,
  async ping() {
    if (!process.env.JSON2VIDEO_API_KEY) return { ok: false, message: "Kein JSON2Video-Key hinterlegt." };
    try {
      const res = await fetch(`${J2V_API}/movies?project=ping`, { headers: { "x-api-key": j2vKey() } });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "JSON2Video-Key wurde abgelehnt (401/403)." };
      }
      return { ok: true, message: "JSON2Video-Verbindung steht." };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Netzwerkfehler" };
    }
  },
  async submit(req) {
    const { width, height } = aspectSize(req.aspect);
    const duration = Math.max(1, req.endS - req.startS);
    const elements: any[] = [
      {
        type: "video",
        src: req.videoUrl,
        start: 0,
        duration,
        "seek": Math.max(0, req.startS),
        resize: "cover",
      },
    ];
    if (req.title) {
      elements.push({
        type: "text",
        text: req.title,
        start: 0,
        duration: Math.min(duration, 4),
        position: "bottom-center",
        settings: { "font-size": "5vh", color: "#ffffff" },
      });
    }
    if (req.musicUrl) {
      elements.push({ type: "audio", src: req.musicUrl, start: 0, duration, volume: req.musicVolume });
    }
    const res = await fetch(`${J2V_API}/movies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": j2vKey() },
      body: JSON.stringify({
        resolution: "custom",
        width,
        height,
        quality: "high",
        scenes: [{ elements }],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`JSON2Video ${res.status}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    const id = json?.project;
    if (!id) throw new Error("JSON2Video lieferte keine Projekt-ID");
    return { id };
  },
  async fetch(id) {
    const res = await fetch(`${J2V_API}/movies?project=${encodeURIComponent(id)}`, {
      headers: { "x-api-key": j2vKey() },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`JSON2Video Status ${res.status}: ${text.slice(0, 300)}`);
    const m = JSON.parse(text)?.movie ?? {};
    const status: CreatomateRender["status"] =
      m.status === "done" ? (m.success === false ? "failed" : "succeeded") : m.status === "error" ? "failed" : "rendering";
    return {
      id,
      status,
      url: m.url,
      snapshot_url: m.thumbnail,
      error_message: m.message,
    };
  },
};

const REGISTRY: Record<RenderProviderId, RenderProvider> = { creatomate, shotstack, json2video };

export function renderProvider(id: string | null | undefined): RenderProvider {
  return REGISTRY[isRenderProviderId(id) ? id : "creatomate"];
}

/** Status aller Provider für die UI-Auswahl. */
export function renderProviderCatalog() {
  return RENDER_PROVIDER_IDS.map((id) => {
    const p = REGISTRY[id];
    return {
      id: p.id,
      label: p.label,
      configured: p.configured(),
      supportsWebhook: p.supportsWebhook && (p.id !== "creatomate" || !!webhookUrl()),
      keyName: p.keyName,
      docsUrl: p.docsUrl,
      note: p.note,
    };
  });
}
