// ============================================================
// Analytics-Sync (nur Server).
//
// ACHTUNG: aktuell werden KEINE echten Zahlen geholt: TikTok/IG/YT/FB/X
// verlangen für Insights alle eine geprüfte Developer-App. Bis die
// Reviews durch sind, wird pro verbundenem Account ein plausibler
// Snapshot erzeugt und gespeichert. Die Zahlen in der Oberfläche sind
// deshalb Platzhalter, keine Realdaten.
//
// Sobald OAuth + Review pro Plattform stehen, wird mockMetrics() durch
// die echten Insights-Abrufe ersetzt.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AnalyticsSyncResult = { synced: number; simulated: boolean };

/**
 * Erzeugt für jeden verbundenen Social-Account einen Metrik-Snapshot.
 *
 * @param userId  Wenn gesetzt, werden nur Accounts dieses Nutzers
 *                synchronisiert. Ohne Angabe laufen alle (Cron-Modus).
 */
export async function syncAnalytics(
  supabaseAdmin: any,
  userId?: string,
): Promise<AnalyticsSyncResult> {
  let query = supabaseAdmin
    .from("social_accounts")
    .select("id, user_id, brand_id, platform, status")
    .neq("status", "disconnected");
  if (userId) query = query.eq("user_id", userId);

  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);

  let synced = 0;
  for (const acc of (accounts ?? []).filter((a: any) => a.brand_id)) {
    try {
      const metrics = mockMetrics();
      await supabaseAdmin.from("analytics_snapshots").insert({
        user_id: acc.user_id,
        brand_id: acc.brand_id,
        social_account_id: acc.id,
        platform: String(acc.platform ?? "unknown"),
        metrics,
      });
      await supabaseAdmin
        .from("social_accounts")
        .update({ status: "connected", last_sync_at: new Date().toISOString(), sync_error: null })
        .eq("id", acc.id);
      synced++;
    } catch (e) {
      await supabaseAdmin
        .from("social_accounts")
        .update({ status: "error", sync_error: e instanceof Error ? e.message : "sync failed" })
        .eq("id", acc.id);
    }
  }

  return { synced, simulated: true };
}

/** Platzhalter-Metriken, bis die echten Insights-APIs freigeschaltet sind. */
function mockMetrics() {
  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min);
  return {
    views: rand(500, 25000),
    likes: rand(20, 3000),
    comments: rand(0, 400),
    shares: rand(0, 300),
    avg_watch_pct: rand(30, 85),
    drop_off_pct: rand(10, 60),
  };
}
