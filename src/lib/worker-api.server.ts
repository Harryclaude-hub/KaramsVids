// ============================================================
// Gemeinsamer Unterbau fuer die Worker-Schnittstelle /api/worker/*.
//
// Warum es diese Schicht gibt: Auf Lovable Cloud kommt der
// Service-Role-Schluessel nicht nach aussen. Der lokale Python-Worker kann die
// Datenbank dort also nicht mehr selbst anfassen. Stattdessen ruft er diese
// Routen ueber HTTP auf, und die App erledigt die Datenbankarbeit mit
// supabaseAdmin. Der bisherige Direktzugriff bleibt fuer Nutzer mit eigenem
// Supabase als zweiter Modus bestehen.
//
// Ausweis des Workers: Header "Authorization: Bearer <WORKER_SECRET>".
//   WORKER_SECRET am Server nicht gesetzt -> 503 (bewusst geschlossen, damit
//     eine halb eingerichtete Umgebung die Schnittstelle nicht offen laesst)
//   fehlendes oder falsches Secret         -> 401
// Der Vergleich laeuft ueber timingSafeEqual, genau wie in hook-auth.server.ts.
//
// Es wird nie ein Secret geloggt oder in eine Antwort geschrieben.
// ============================================================

import { timingSafeEqual } from "node:crypto";
import type { Json } from "@/integrations/supabase/types";

/** Der Admin-Client, so wie ihn client.server.ts herausgibt. */
export type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Spalten, die der Worker von einem Auftrag zu sehen bekommt. */
export const JOB_COLUMNS =
  "id, user_id, brand_id, mode, options, analysis, created_at, raw_video_id";

export type WorkerJob = {
  id: string;
  user_id: string;
  brand_id: string | null;
  mode: string;
  options: Record<string, unknown>;
  analysis: Json | null;
  created_at: string;
  raw_video_id: string;
};

/** Einheitliche JSON-Antwort. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Gibt null zurueck, wenn der Aufruf ein gueltiges WORKER_SECRET mitbringt,
 * sonst die fertige Fehlerantwort (503 ohne Secret am Server, sonst 401).
 *
 * Vorgesehen ist "Authorization: Bearer <WORKER_SECRET>". Ein Header, der nur
 * das nackte Secret enthaelt, wird ebenfalls angenommen, genau wie in
 * hook-auth.server.ts. Der Wert muss in jedem Fall exakt stimmen.
 */
export function checkWorkerSecret(request: Request): Response | null {
  const expected = process.env.WORKER_SECRET;
  if (!expected) return json({ ok: false, error: "WORKER_SECRET fehlt" }, 503);

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer && sameSecret(bearer, expected)) return null;

  return json({ ok: false, error: "Nicht autorisiert" }, 401);
}

/** Liest den Rumpf als JSON-Objekt. null bei kaputtem oder falsch geformtem Rumpf. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Nicht leerer Text aus dem Rumpf, sonst null. */
export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Text, oder null wenn das Feld fehlt oder kein Text ist. */
export function readNullableString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

/** Endliche Zahl aus dem Rumpf, sonst null. */
export function readNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** Objekt (kein Array, kein null) aus dem Rumpf, sonst null. */
export function readObject(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = body[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** options einer Auftragszeile als flaches Objekt, egal was drin stand. */
export function asOptions(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

/** Bruecke zum Json-Typ der erzeugten Datenbank-Typen. */
export function asJson(value: unknown): Json {
  return value as Json;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Fortschritt hart auf 0..100 begrenzen. */
export function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Die oeffentlichen Storage-Werte fuer die Antwort von /claim. Beides sind
 * oeffentliche Werte, der Service-Role-Schluessel bleibt am Server.
 */
export function publicStorageConfig(): { supabaseUrl: string; publishableKey: string } | null {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!supabaseUrl || !publishableKey) return null;
  return { supabaseUrl, publishableKey };
}

/** Der Admin-Client, absichtlich erst beim Aufruf geladen. */
export async function getAdmin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Eine Zeile aus edit_jobs in die Form bringen, die die Routen erwarten. */
export function toJob(row: Record<string, unknown>): WorkerJob {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    brand_id: (row.brand_id as string | null) ?? null,
    mode: String(row.mode),
    options: asOptions(row.options),
    analysis: (row.analysis as Json | null) ?? null,
    created_at: String(row.created_at),
    raw_video_id: String(row.raw_video_id),
  };
}

/** Der in options hinterlegte Worker, oder "" wenn noch keiner dran ist. */
export function claimedBy(options: Record<string, unknown>): string {
  const value = options.worker_id;
  return typeof value === "string" ? value : "";
}

type JobLookup = { job: WorkerJob; error?: undefined } | { job?: undefined; error: Response };

/**
 * Laedt den Auftrag und prueft, dass er dem aufrufenden Worker gehoert.
 * Unbekannter Auftrag oder fremder Worker: 409, damit der Worker den Fall von
 * einem echten Serverfehler unterscheiden kann.
 */
export async function loadOwnedJob(
  admin: Admin,
  jobId: string,
  workerId: string,
): Promise<JobLookup> {
  const { data, error } = await admin
    .from("edit_jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    return {
      error: json(
        { ok: false, error: "Auftrag konnte nicht gelesen werden: " + error.message },
        500,
      ),
    };
  }
  if (!data) {
    return { error: json({ ok: false, error: "Auftrag nicht gefunden" }, 409) };
  }

  const job = toJob(data as unknown as Record<string, unknown>);
  if (claimedBy(job.options) !== workerId) {
    return { error: json({ ok: false, error: "Auftrag gehoert einem anderen Worker" }, 409) };
  }
  return { job };
}

type Prepared =
  | {
      ok: true;
      body: Record<string, unknown>;
      workerId: string;
      jobId: string;
      job: WorkerJob;
      admin: Admin;
    }
  | { ok: false; response: Response };

/**
 * Der immer gleiche Vorlauf der Routen 2 bis 7: Secret pruefen, Rumpf lesen,
 * jobId und workerId holen, Auftrag laden und Besitz pruefen.
 */
export async function prepareJobRequest(request: Request): Promise<Prepared> {
  const denied = checkWorkerSecret(request);
  if (denied) return { ok: false, response: denied };

  const body = await readJsonBody(request);
  if (!body) {
    return {
      ok: false,
      response: json({ ok: false, error: "Rumpf muss ein JSON-Objekt sein" }, 400),
    };
  }

  const jobId = readString(body, "jobId");
  const workerId = readString(body, "workerId");
  if (!jobId) return { ok: false, response: json({ ok: false, error: "jobId fehlt" }, 400) };
  if (!workerId) return { ok: false, response: json({ ok: false, error: "workerId fehlt" }, 400) };

  // Alles ab hier kann werfen, etwa wenn die Server-Umgebung unvollstaendig
  // ist. Der Worker liest nur JSON, deshalb darf hier keine HTML-Fehlerseite
  // durchschlagen.
  try {
    const admin = await getAdmin();
    const found = await loadOwnedJob(admin, jobId, workerId);
    if (found.error) return { ok: false, response: found.error };

    return { ok: true, body, workerId, jobId, job: found.job, admin };
  } catch (e) {
    return {
      ok: false,
      response: json(
        { ok: false, error: failureText(e, "Auftrag konnte nicht geladen werden") },
        500,
      ),
    };
  }
}

/** options mit frischem Herzschlag und optionaler Ergaenzung. */
export function touchedOptions(
  options: Record<string, unknown>,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...options, ...patch, worker_heartbeat: nowIso() };
}

/** Einheitlicher Text fuer einen unerwarteten Fehler in einer Route. */
export function failureText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
