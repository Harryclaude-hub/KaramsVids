// ============================================================
// Direktnachrichten (DMs) einsammeln und beantworten (nur Server).
//
// Abgedeckt (beides ueber die Meta Graph API und den Seiten-Token):
//   Instagram  → /{page-id}/conversations?platform=instagram (lesen)
//                /{page-id}/messages (antworten)
//   Facebook   → /{page-id}/conversations?platform=messenger (lesen)
//                /{page-id}/messages (antworten)
//
// Nicht abgedeckt, dafuer mit klarer Fehlermeldung statt Attrappe:
//   TikTok     → stellt keine DM-Schnittstelle bereit
//   YouTube    → hat keine Direktnachrichten
//   X          → DM-Schnittstelle ist hier nicht angebunden
//
// Das 24-Stunden-Fenster von Meta:
//   Eine Seite darf einer Person nur innerhalb von 24 Stunden nach deren
//   letzter Nachricht antworten. Danach lehnt Meta den Versand ab.
//   sendDm prueft das vorab anhand der gespeicherten Nachrichten und
//   uebersetzt die Ablehnung von Meta zusaetzlich in eine klare Meldung.
//
// Voraussetzungen bei Meta (siehe Scopes in social-oauth.server.ts):
//   Instagram: instagram_manage_messages, ausserdem muss im Instagram-Konto
//              unter "Verbundene Tools" der Nachrichtenzugriff erlaubt sein.
//   Facebook:  pages_messaging
//   Bereits verbundene Kanaele muessen dafuer einmal neu verbunden werden.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { refreshIfNeeded, type Platform } from "./social-oauth.server";
import type { AccountRow } from "./social-comments.server";

export type InboundDm = {
  /** Konversation bei der Plattform (Graph: conversation id, beginnt mit "t_"). */
  externalThreadId: string;
  /** Einzelne Nachricht bei der Plattform (Graph: message id, beginnt mit "m_"). */
  externalMessageId: string;
  /** PSID (Messenger) bzw. IGSID (Instagram). Genau diese ID ist der Empfaenger der Antwort. */
  senderId: string;
  senderName: string | null;
  text: string;
  receivedAt: string | null;
  /**
   * Zeitpunkt der letzten eigenen Nachricht im selben Thread, soweit im
   * geladenen Fenster sichtbar. Liegt sie nach receivedAt, hat der Betreiber
   * (etwa per Handy-App) schon geantwortet und die Automatik soll still bleiben.
   */
  ownLastAt: string | null;
};

const GRAPH = "https://graph.facebook.com/v21.0";
/** Wie viele Konversationen je Durchlauf angeschaut werden. */
const MAX_THREADS = 25;
/** Wie viele Nachrichten je Konversation geladen werden. */
const MAX_MESSAGES_PER_THREAD = 20;
/** Nur Nachrichten der letzten Tage werden eingesammelt. */
export const DM_LOOKBACK_DAYS = 3;
/** Meta erlaubt Antworten nur so lange nach der letzten Nachricht der Person. */
export const DM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Laengenlimits je Nachricht laut Meta-Doku (Messenger 2000, Instagram 1000).
 * Sollte Meta die Werte aendern, meldet der Versand trotzdem einen Fehler.
 */
const MAX_TEXT_LENGTH: Record<string, number> = { facebook: 2000, instagram: 1000 };

export const DM_PLATFORMS: Platform[] = ["instagram", "facebook"];

export function supportsDms(platform: string): boolean {
  return (DM_PLATFORMS as string[]).includes(platform);
}

/** Verstaendliche Meldung fuer Plattformen ohne DM-Anbindung. */
export function unsupportedDmMessage(platform: string): string {
  switch (platform) {
    case "tiktok":
      return "Direktnachrichten für TikTok werden nicht unterstützt: TikTok stellt dafür keine Schnittstelle bereit.";
    case "youtube":
      return "Direktnachrichten für YouTube werden nicht unterstützt: YouTube hat keine Direktnachrichten.";
    case "x":
      return "Direktnachrichten für X werden nicht unterstützt: die DM-Schnittstelle von X ist hier nicht angebunden.";
    default:
      return `Direktnachrichten für ${platform} werden nicht unterstützt.`;
  }
}

function platformLabel(platform: string): string {
  return platform === "instagram" ? "Instagram" : platform === "facebook" ? "Facebook" : platform;
}

async function json(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

/**
 * Graph liefert Zeiten als "2024-05-01T10:20:30+0000". Der Offset ohne
 * Doppelpunkt ist kein sauberes ISO 8601, deshalb wird er hier normalisiert.
 */
function graphTimeToIso(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/^@/, "").trim();
}

/**
 * Alle IDs und Namen, unter denen der eigene Kanal in einer Konversation
 * auftauchen kann. Bei Instagram ist nicht sicher, ob Meta die Seiten-ID oder
 * die Instagram-Account-ID als Absender eigener Nachrichten liefert, deshalb
 * werden alle bekannten Kennungen verglichen.
 */
export function ownIdentities(account: AccountRow & { display_name?: string | null }): {
  ids: Set<string>;
  names: Set<string>;
} {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const v of [account.external_id, account.meta?.page_id, account.meta?.ig_user_id]) {
    if (v) ids.add(String(v));
  }
  for (const v of [
    account.handle,
    account.display_name,
    account.meta?.ig_username,
    account.meta?.page_name,
  ]) {
    if (v) names.add(normalizeName(String(v)));
  }
  return { ids, names };
}

/** Die Facebook-Seite, ueber die Messenger- und Instagram-DMs laufen. */
function pageIdOf(account: AccountRow): string {
  const pageId =
    account.meta?.page_id ?? (account.platform === "facebook" ? account.external_id : null);
  if (!pageId)
    throw new Error(
      `${platformLabel(account.platform)}: Facebook-Seiten-ID fehlt, bitte Account neu verbinden`,
    );
  return String(pageId);
}

// ============================================================
// Lesen
// ============================================================

export async function fetchDms(supabaseAdmin: any, account: AccountRow): Promise<InboundDm[]> {
  if (!supportsDms(account.platform)) throw new Error(unsupportedDmMessage(account.platform));
  const token = await refreshIfNeeded(supabaseAdmin, account as never);
  return fetchMetaConversations(
    token,
    account,
    account.platform === "instagram" ? "instagram" : "messenger",
  );
}

async function fetchMetaConversations(
  token: string,
  account: AccountRow,
  platform: "instagram" | "messenger",
): Promise<InboundDm[]> {
  const pageId = pageIdOf(account);

  // Felder laut Graph-Doku fuer die Edge "conversations":
  //   id, updated_time, participants, messages{...}
  // Die Nachrichten werden direkt mitgeladen (Field Expansion), damit nicht
  // fuer jede Konversation ein eigener Aufruf noetig ist.
  // Unsicher: ob "messages" bei Instagram immer "from.username" liefert;
  // deshalb faellt der Name auf "from.name" zurueck und darf null sein.
  const fields =
    `id,updated_time,participants,` +
    `messages.limit(${MAX_MESSAGES_PER_THREAD}){id,message,from,created_time}`;
  const url =
    `${GRAPH}/${pageId}/conversations?platform=${platform}` +
    `&fields=${encodeURIComponent(fields)}&limit=${MAX_THREADS}&access_token=${token}`;

  const res = await fetch(url);
  const j = await json(res);
  if (!res.ok || j.error)
    throw new Error(translateReadError(account.platform, j.error, res.status));

  const own = ownIdentities(account);
  const isOwn = (from: any): boolean => {
    if (!from) return false;
    if (from.id && own.ids.has(String(from.id))) return true;
    const name = from.username ?? from.name;
    return !!name && own.names.has(normalizeName(String(name)));
  };

  const cutoff = Date.now() - DM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const out: InboundDm[] = [];

  for (const conv of j.data ?? []) {
    const threadId = conv?.id ? String(conv.id) : null;
    if (!threadId) continue;

    // Aeltere Konversationen werden uebersprungen, nicht abgebrochen: Graph
    // sortiert nach updated_time absteigend, das ist aber nicht garantiert.
    const updatedAt = toMs(graphTimeToIso(conv.updated_time));
    if (updatedAt && updatedAt < cutoff) continue;

    const messages: any[] = Array.isArray(conv.messages?.data) ? conv.messages.data : [];

    let ownLastAt: string | null = null;
    for (const m of messages) {
      if (!isOwn(m?.from)) continue;
      const at = graphTimeToIso(m.created_time);
      if (at && toMs(at) > toMs(ownLastAt)) ownLastAt = at;
    }

    for (const m of messages) {
      if (!m?.id || !m.from?.id) continue;
      if (isOwn(m.from)) continue;
      const receivedAt = graphTimeToIso(m.created_time);
      if (receivedAt && toMs(receivedAt) < cutoff) continue;

      // Nachrichten ohne Text (nur Anhang, Sticker, Story-Reaktion) landen
      // trotzdem im Posteingang, dann mit leerem Text. Regeln mit
      // Stichwoertern greifen darauf nicht, Regeln ohne Stichwoerter schon.
      out.push({
        externalThreadId: threadId,
        externalMessageId: String(m.id),
        senderId: String(m.from.id),
        senderName: m.from.username ?? m.from.name ?? null,
        text: typeof m.message === "string" ? m.message : "",
        receivedAt,
        ownLastAt,
      });
    }
  }

  return out;
}

function translateReadError(platform: string, error: any, status: number): string {
  const label = platformLabel(platform);
  const code = Number(error?.code ?? 0);
  const msg: string = error?.message ?? String(status);
  const scope = platform === "instagram" ? "instagram_manage_messages" : "pages_messaging";

  // Code 190: Token abgelaufen oder ungueltig.
  if (code === 190) return `${label}: Der Zugang ist abgelaufen, bitte Account neu verbinden.`;
  // Code 10 und 200: fehlende Berechtigung. Typischer Fall nach dem Ausbau um
  // DMs, weil aeltere Verbindungen den Scope noch nicht haben.
  if (code === 10 || code === 200 || /permission/i.test(msg))
    return `${label}: Der Zugriff auf Direktnachrichten fehlt. Account bitte trennen und neu verbinden, damit das Recht ${scope} erteilt wird. ${msg}`;
  return `${label}-Direktnachrichten: ${msg}`;
}

// ============================================================
// 24-Stunden-Fenster
// ============================================================

/**
 * Sagt, ob eine Antwort an eine Person gerade erlaubt ist. lastInboundAt ist
 * der Zeitpunkt der letzten Nachricht dieser Person an den Kanal.
 */
export function replyWindow(lastInboundAt: string | null): {
  open: boolean;
  closesAt: string | null;
} {
  const at = toMs(lastInboundAt);
  if (!at) return { open: false, closesAt: null };
  const closes = at + DM_REPLY_WINDOW_MS;
  return { open: Date.now() < closes, closesAt: new Date(closes).toISOString() };
}

function assertReplyWindow(lastInboundAt: string | null) {
  const w = replyWindow(lastInboundAt);
  if (!lastInboundAt || !w.closesAt)
    throw new Error(
      "Meta erlaubt Seiten keine Nachricht ohne vorherige Nachricht der Person. Zu diesem Empfänger ist keine eingehende Nachricht bekannt.",
    );
  if (!w.open) {
    const last = new Date(lastInboundAt).toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
    throw new Error(
      `Das 24-Stunden-Fenster von Meta ist abgelaufen (letzte Nachricht der Person: ${last}). Eine Antwort ist erst wieder möglich, wenn die Person erneut schreibt.`,
    );
  }
}

/** Letzte gespeicherte eingehende Nachricht einer Person an diesen Kanal. */
async function lastInboundFromDb(
  supabaseAdmin: any,
  accountId: string,
  senderId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("social_dms")
    .select("received_at")
    .eq("social_account_id", accountId)
    .eq("sender_id", senderId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.received_at ?? null;
}

// ============================================================
// Antworten
// ============================================================

/**
 * Schickt eine Textnachricht an recipientId (PSID bzw. IGSID).
 * opts.lastInboundAt: Zeitpunkt der letzten Nachricht der Person, falls der
 * Aufrufer ihn schon kennt. Fehlt er, wird er aus social_dms geholt.
 */
export async function sendDm(
  supabaseAdmin: any,
  account: AccountRow,
  recipientId: string,
  text: string,
  opts: { lastInboundAt?: string | null } = {},
): Promise<void> {
  if (!supportsDms(account.platform)) throw new Error(unsupportedDmMessage(account.platform));
  const body = text.trim();
  if (!body) throw new Error("Leere Antwort");
  if (!recipientId) throw new Error("Empfänger-ID fehlt");

  const label = platformLabel(account.platform);
  const max = MAX_TEXT_LENGTH[account.platform];
  if (max && body.length > max)
    throw new Error(
      `${label} erlaubt höchstens ${max} Zeichen je Nachricht (Antwort hat ${body.length}).`,
    );

  const lastInboundAt =
    opts.lastInboundAt !== undefined
      ? opts.lastInboundAt
      : await lastInboundFromDb(supabaseAdmin, account.id, recipientId);
  assertReplyWindow(lastInboundAt);

  const token = await refreshIfNeeded(supabaseAdmin, account as never);
  const pageId = pageIdOf(account);

  // Messenger verlangt messaging_type; RESPONSE steht fuer eine Antwort im
  // 24-Stunden-Fenster. Instagram kennt das Feld laut Doku nicht, deshalb
  // wird es dort weggelassen.
  const payload: Record<string, unknown> = {
    recipient: { id: recipientId },
    message: { text: body },
    access_token: token,
  };
  if (account.platform === "facebook") payload.messaging_type = "RESPONSE";

  const res = await fetch(`${GRAPH}/${pageId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await json(res);
  if (!res.ok || j.error)
    throw new Error(translateSendError(account.platform, j.error, res.status));
}

function translateSendError(platform: string, error: any, status: number): string {
  const label = platformLabel(platform);
  const code = Number(error?.code ?? 0);
  const sub = Number(error?.error_subcode ?? 0);
  const msg: string = error?.message ?? String(status);
  const scope = platform === "instagram" ? "instagram_manage_messages" : "pages_messaging";

  // Geschlossenes 24-Stunden-Fenster: Code 10 mit Subcode 2018278 (Messenger)
  // bzw. 2534022 (Instagram), beides laut Meta-Doku. Sollte sich das aendern,
  // greift immer noch die Vorab-Pruefung in sendDm.
  if (code === 10 && (sub === 2018278 || sub === 2534022))
    return "Das 24-Stunden-Fenster von Meta ist abgelaufen. Eine Antwort ist erst wieder möglich, wenn die Person erneut schreibt.";
  if (code === 190) return `${label}: Der Zugang ist abgelaufen, bitte Account neu verbinden.`;
  if (code === 10 || code === 200)
    return `${label}: Senden nicht erlaubt. Account bitte neu verbinden, damit das Recht ${scope} erteilt wird. ${msg}`;
  // Code 551: Die Person ist nicht erreichbar (blockiert, deaktiviert oder Unterhaltung beendet).
  if (code === 551)
    return `${label}: Die Person ist gerade nicht erreichbar (blockiert oder Unterhaltung beendet).`;
  return `${label}-Nachricht: ${msg}`;
}
