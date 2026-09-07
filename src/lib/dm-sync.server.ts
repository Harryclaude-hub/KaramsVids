// ============================================================
// Der DM-Durchlauf: einsammeln, Regel suchen, antworten.
// Gleiche Aufteilung wie beim Kommentar-Durchlauf (comment-sync.server.ts),
// damit Cron-Hook und Knopf in der App garantiert dasselbe tun.
//
// Unterschiede zu Kommentaren:
//   - Eine DM gehoert zu einem Thread. Je Thread wird pro Durchlauf hoechstens
//     einmal geantwortet, und zwar auf die neueste Nachricht. Sonst bekommt
//     jemand, der drei Nachrichten hintereinander schickt, drei gleiche Antworten.
//   - Hat der Betreiber im Thread nach der Nachricht schon selbst geantwortet
//     (etwa per Handy-App), bleibt die Automatik still.
//   - Meta erlaubt Antworten nur 24 Stunden nach der letzten Nachricht der
//     Person. Aeltere Nachrichten werden gar nicht erst versucht.
//   - Verzoegerte Regeln (delay_minutes) funktionieren ueber mehrere
//     Durchlaeufe: die Nachricht bleibt "new", bis die Wartezeit um ist.
//   - Fehler beim Abruf landen nur im Ergebnis (problems), nicht in
//     social_accounts.sync_error, damit ein fehlender DM-Scope nicht den
//     ganzen Kanal als kaputt markiert.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { matchRule, buildReply } from "./social-comments.server";
import {
  fetchDms,
  sendDm,
  supportsDms,
  unsupportedDmMessage,
  ownIdentities,
  normalizeName,
  DM_REPLY_WINDOW_MS,
  type InboundDm,
} from "./social-dms.server";

export type DmSyncOptions = {
  /** Nur diesen Account abarbeiten. */
  accountId?: string | null;
  /** Nur diesem Nutzer gehoerende Accounts (fuer Aufrufe aus der App). */
  userId?: string | null;
  /** Nachrichten einsammeln, aber nichts beantworten. */
  dryRun?: boolean;
};

export type DmSyncResult = {
  /** Accounts, die tatsaechlich abgefragt wurden (nur Instagram und Facebook). */
  accounts: number;
  fetched: number;
  new: number;
  replied: number;
  problems: Array<{ account: string; error: string }>;
};

const ACCOUNT_FIELDS =
  "id, user_id, brand_id, platform, external_id, handle, display_name, auto_reply_dms_enabled, " +
  "access_token_encrypted, refresh_token_encrypted, expires_at, meta";

const NO_USER = "00000000-0000-0000-0000-000000000000";

type ThreadInfo = {
  newestMessageId: string;
  newestAt: number;
  ownLastAt: number;
};

function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function runDmSync(
  supabaseAdmin: any,
  opts: DmSyncOptions = {},
): Promise<DmSyncResult> {
  let query = supabaseAdmin
    .from("social_accounts")
    .select(ACCOUNT_FIELDS)
    .eq("status", "connected");
  if (opts.accountId) query = query.eq("id", opts.accountId);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);

  const userIds = [...new Set((accounts ?? []).map((a: any) => a.user_id))];
  // Nur Regeln fuer DMs (oder fuer beides). Reine Kommentar-Regeln bleiben aussen vor.
  const { data: allRules } = await supabaseAdmin
    .from("comment_reply_rules")
    .select("*")
    .eq("active", true)
    .in("channel", ["dm", "both"])
    .in("user_id", userIds.length ? userIds : [NO_USER]);

  const { data: brands } = await supabaseAdmin.from("brands").select("id, name");
  const brandName = new Map<string, string>(
    (brands ?? []).map((b: any) => [String(b.id), String(b.name)]),
  );

  // Tageszaehler je Regel ueber alle Accounts hinweg. Gezaehlt werden DMs und
  // Kommentare zusammen, damit eine "both"-Regel ihr Limit nicht doppelt bekommt.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const usedToday = new Map<string, number>();
  for (const table of ["social_dms", "social_comments"]) {
    const { data: rows } = await supabaseAdmin
      .from(table)
      .select("rule_id")
      .eq("status", "replied")
      .gte("replied_at", since);
    for (const r of rows ?? []) {
      if (r.rule_id) usedToday.set(r.rule_id, (usedToday.get(r.rule_id) ?? 0) + 1);
    }
  }

  const result: DmSyncResult = { accounts: 0, fetched: 0, new: 0, replied: 0, problems: [] };

  for (const acc of accounts ?? []) {
    const accountLabel: string = acc.handle ?? acc.display_name ?? acc.id;

    if (!supportsDms(acc.platform)) {
      // Nur melden, wenn dieser Account ausdruecklich angefragt wurde. Beim
      // Gesamtdurchlauf wuerde sonst jeder TikTok-Kanal bei jedem Lauf meckern.
      if (opts.accountId)
        result.problems.push({ account: accountLabel, error: unsupportedDmMessage(acc.platform) });
      continue;
    }
    result.accounts++;

    let inbound: InboundDm[];
    try {
      inbound = await fetchDms(supabaseAdmin, acc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DM-Abruf fehlgeschlagen";
      result.problems.push({ account: accountLabel, error: msg });
      await stampSync(supabaseAdmin, acc.id);
      continue;
    }

    result.fetched += inbound.length;
    const own = ownIdentities(acc);
    const threads = new Map<string, ThreadInfo>();

    // ---------- Phase 1: einsammeln ----------
    for (const dm of inbound) {
      // fetchDms filtert eigene Nachrichten schon heraus, das hier ist das
      // doppelte Netz: eigene Nachrichten nie beantworten.
      const isOwn =
        own.ids.has(dm.senderId) ||
        (!!dm.senderName && own.names.has(normalizeName(dm.senderName)));

      if (!isOwn) {
        const at = ms(dm.receivedAt);
        const t = threads.get(dm.externalThreadId);
        if (!t || at > t.newestAt) {
          threads.set(dm.externalThreadId, {
            newestMessageId: dm.externalMessageId,
            newestAt: at,
            ownLastAt: ms(dm.ownLastAt),
          });
        }
      }

      const { data: existing } = await supabaseAdmin
        .from("social_dms")
        .select("id")
        .eq("social_account_id", acc.id)
        .eq("external_message_id", dm.externalMessageId)
        .maybeSingle();
      if (existing) continue;

      const { error: insErr } = await supabaseAdmin.from("social_dms").insert({
        user_id: acc.user_id,
        brand_id: acc.brand_id,
        social_account_id: acc.id,
        platform: acc.platform,
        external_thread_id: dm.externalThreadId,
        external_message_id: dm.externalMessageId,
        sender_id: dm.senderId,
        sender_name: dm.senderName,
        text: dm.text,
        received_at: dm.receivedAt,
        status: isOwn ? "skipped" : "new",
      });
      // Der Unique-Index faengt Doppelungen ab, wenn zwei Durchlaeufe sich ueberlappen.
      if (insErr) continue;
      result.new++;
    }

    if (opts.dryRun || !acc.auto_reply_dms_enabled) {
      await stampSync(supabaseAdmin, acc.id);
      continue;
    }

    // ---------- Phase 2: je Thread hoechstens eine Antwort ----------
    const rules = (allRules ?? []).filter((r: any) => r.user_id === acc.user_id);
    const brand = acc.brand_id ? (brandName.get(acc.brand_id) ?? null) : null;

    for (const t of threads.values()) {
      // Der Betreiber hat nach der neuesten Nachricht schon selbst geantwortet.
      if (t.ownLastAt && t.newestAt && t.ownLastAt > t.newestAt) continue;
      // Ausserhalb des 24-Stunden-Fensters kann nichts mehr gesendet werden.
      if (!t.newestAt || Date.now() - t.newestAt > DM_REPLY_WINDOW_MS) continue;

      const { data: row } = await supabaseAdmin
        .from("social_dms")
        .select("id, status, text, sender_id, sender_name, received_at")
        .eq("social_account_id", acc.id)
        .eq("external_message_id", t.newestMessageId)
        .maybeSingle();
      // Nur "new" wird beantwortet: replied, skipped und failed bleiben unberuehrt,
      // damit jede Nachricht hoechstens einmal automatisch beantwortet wird.
      if (!row || row.status !== "new") continue;

      const subject = {
        authorName: (row.sender_name ?? null) as string | null,
        text: String(row.text ?? ""),
      };
      const rule = matchRule(rules, subject, acc, "dm");
      if (!rule) continue;

      const used = usedToday.get(rule.id) ?? 0;
      if (used >= rule.daily_limit) continue;

      // Verzoegerung: die Nachricht bleibt "new", bis genug Zeit vergangen ist,
      // und wird im naechsten Durchlauf erneut geprueft.
      if (rule.delay_minutes > 0 && row.received_at) {
        const ready = ms(row.received_at) + rule.delay_minutes * 60_000;
        if (Date.now() < ready) continue;
      }

      try {
        const { text, mode } = await buildReply(rule, subject, brand, "dm");
        await sendDm(supabaseAdmin, acc, row.sender_id, text, { lastInboundAt: row.received_at });
        await supabaseAdmin
          .from("social_dms")
          .update({
            status: "replied",
            reply_text: text,
            reply_mode: mode,
            rule_id: rule.id,
            replied_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", row.id);
        usedToday.set(rule.id, used + 1);
        result.replied++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Antwort fehlgeschlagen";
        await supabaseAdmin
          .from("social_dms")
          .update({ status: "failed", rule_id: rule.id, error: msg })
          .eq("id", row.id);
        result.problems.push({ account: accountLabel, error: msg });
      }
    }

    await stampSync(supabaseAdmin, acc.id);
  }

  return result;
}

async function stampSync(supabaseAdmin: any, accountId: string) {
  await supabaseAdmin
    .from("social_accounts")
    .update({ last_dm_sync_at: new Date().toISOString() })
    .eq("id", accountId);
}
