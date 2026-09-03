// ============================================================
// Kern der Publishing-Warteschlange (nur Server).
//
// Wird von zwei Stellen aufgerufen:
//   1. /api/public/hooks/process-publish-queue  — pg_cron, alle Nutzer
//   2. runPublishQueue() in hooks.functions.ts  — „Jetzt ausführen"
//      aus der UI, eingeschränkt auf den angemeldeten Nutzer
//
// Für jeden fälligen Zeitplan werden die nächsten N Clips aus der
// Warteschlange geholt (status='queued', gleiche Brand + Plattform,
// sortiert nach queue_position), publiziert und next_run_at neu
// berechnet.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ergebnis eines einzelnen Zeitplans — bewusst JSON-serialisierbar. */
export type PublishQueueDetail = {
  schedule_id: string;
  brands?: string[];
  platforms?: string[];
  shuffle?: boolean;
  picked?: number;
  next_run_at?: string;
  error?: string;
};

export type PublishQueueResult = {
  published: number;
  schedules_processed: number;
  details: PublishQueueDetail[];
};

/**
 * Arbeitet alle fälligen Publishing-Slots ab.
 *
 * @param userId  Wenn gesetzt, werden nur Zeitpläne dieses Nutzers
 *                verarbeitet. Ohne Angabe laufen alle (Cron-Modus).
 */
export async function processPublishQueue(
  supabaseAdmin: any,
  now: Date = new Date(),
  userId?: string,
): Promise<PublishQueueResult> {
  let scheduleQuery = supabaseAdmin
    .from("publish_schedules")
    .select("*")
    .eq("active", true)
    .lte("next_run_at", now.toISOString());
  if (userId) scheduleQuery = scheduleQuery.eq("user_id", userId);

  const { data: schedules, error: schErr } = await scheduleQuery;
  if (schErr) throw new Error(schErr.message);

  let published = 0;
  const details: PublishQueueDetail[] = [];

  for (const s of schedules ?? []) {
    try {
      // Ein Plan kann mehrere Plattformen bedienen (platforms[]);
      // Altbestand hat nur die einzelne platform-Spalte.
      const platformList: string[] = (
        Array.isArray((s as { platforms?: string[] }).platforms) &&
        ((s as { platforms?: string[] }).platforms?.length ?? 0) > 0
          ? ((s as { platforms?: string[] }).platforms as string[])
          : [s.platform]
      ).filter(Boolean);

      // Ein Plan kann mehrere Brands bedienen (brand_ids[]).
      const brandList: string[] = (
        Array.isArray((s as { brand_ids?: string[] }).brand_ids) &&
        ((s as { brand_ids?: string[] }).brand_ids?.length ?? 0) > 0
          ? ((s as { brand_ids?: string[] }).brand_ids as string[])
          : [s.brand_id]
      ).filter(Boolean);

      const shuffle = Boolean((s as { shuffle?: boolean }).shuffle);

      let pickedTotal = 0;
      for (const brandId of brandList) {
        for (const platform of platformList) {
          const wantedTypes: string[] = Array.isArray((s as { post_types?: string[] }).post_types)
            ? ((s as { post_types?: string[] }).post_types as string[])
            : [];

          let clipQuery = supabaseAdmin
            .from("generated_clips")
            .select("*")
            .eq("brand_id", brandId)
            .eq("platform", platform)
            .eq("status", "queued");
          if (wantedTypes.length > 0) clipQuery = clipQuery.in("post_type", wantedTypes);

          // Beim Mischen einen größeren Pool holen und daraus deterministisch
          // pro Brand+Tag zufällig wählen — so postet nicht jede Brand identisch.
          const poolSize = shuffle ? Math.max(s.videos_per_slot * 8, 20) : s.videos_per_slot;
          const { data: pool, error: clipErr } = await clipQuery
            .order("queue_position", { ascending: true })
            .limit(poolSize);
          if (clipErr) throw new Error(clipErr.message);

          const clips = shuffle
            ? seededShuffle(pool ?? [], `${brandId}|${platform}|${dayKey(now)}`).slice(
                0,
                s.videos_per_slot,
              )
            : (pool ?? []);

          const { data: acc } = await supabaseAdmin
            .from("social_accounts")
            .select(
              "id,status,handle,platform,access_token_encrypted,refresh_token_encrypted,expires_at,meta",
            )
            .eq("brand_id", brandId)
            .eq("platform", platform)
            .neq("status", "disconnected")
            .maybeSingle();

          for (const c of clips) {
            const publishedAt = new Date().toISOString();
            if (!acc) {
              await supabaseAdmin
                .from("generated_clips")
                .update({
                  status: "failed",
                  scheduled_for: publishedAt,
                  publish_error: `Kein verbundener ${platform}-Account für diesen Brand`,
                })
                .eq("id", c.id);
              continue;
            }

            // Affiliate-Link (falls am Clip hinterlegt) an die Caption hängen
            let caption = (c as { post_caption?: string | null }).post_caption ?? null;
            const affId = (c as { affiliate_program_id?: string | null }).affiliate_program_id;
            if (affId) {
              const { data: prog } = await supabaseAdmin
                .from("affiliate_programs")
                .select("link")
                .eq("id", affId)
                .maybeSingle();
              const link = (prog as { link?: string } | null)?.link;
              if (link && !(caption ?? "").includes(link)) {
                caption = [caption ?? "", link].filter(Boolean).join("\n\n");
              }
            }

            try {
              const { publishClip } = await import("@/lib/social-publish.server");
              const result = await publishClip(supabaseAdmin, acc as never, {
                id: c.id,
                storage_path: c.storage_path,
                title: c.title,
                caption_srt: c.caption_srt,
                post_type: (c as { post_type?: string | null }).post_type ?? null,
                post_caption: caption,
                hashtags: (c as { hashtags?: string[] | null }).hashtags ?? null,
              });

              await supabaseAdmin
                .from("generated_clips")
                .update({
                  status: "published",
                  scheduled_for: publishedAt,
                  published_at: publishedAt,
                  published_url: result.url,
                  publish_error: result.note ?? null,
                })
                .eq("id", c.id);
              published++;
            } catch (e) {
              await supabaseAdmin
                .from("generated_clips")
                .update({
                  status: "failed",
                  scheduled_for: publishedAt,
                  publish_error: e instanceof Error ? e.message : String(e),
                })
                .eq("id", c.id);
            }
          }

          pickedTotal += clips.length;
        } // Ende Plattform-Schleife
      } // Ende Brand-Schleife

      const nextRun = computeNextRun(s, now);
      await supabaseAdmin
        .from("publish_schedules")
        .update({
          last_run_at: now.toISOString(),
          next_run_at: nextRun.toISOString(),
        })
        .eq("id", s.id);

      details.push({
        schedule_id: s.id,
        brands: brandList,
        platforms: platformList,
        shuffle,
        picked: pickedTotal,
        next_run_at: nextRun.toISOString(),
      });
    } catch (e) {
      details.push({ schedule_id: s.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { published, schedules_processed: schedules?.length ?? 0, details };
}

type Schedule = {
  cadence: string;
  weekdays: number[] | null;
  time_of_day: string; // 'HH:MM:SS' oder 'HH:MM'
  interval_minutes?: number | null;
};

export function computeNextRun(s: Schedule, from: Date): Date {
  // Intervall-Kadenz: einfach "jetzt + X Minuten"
  if (s.cadence === "interval" && s.interval_minutes && s.interval_minutes > 0) {
    return new Date(from.getTime() + s.interval_minutes * 60_000);
  }

  const [hh, mm] = (s.time_of_day ?? "18:00").split(":").map((x) => parseInt(x, 10));
  const base = new Date(from);
  base.setSeconds(0, 0);

  const build = (d: Date) => {
    const x = new Date(d);
    x.setHours(hh || 0, mm || 0, 0, 0);
    return x;
  };

  if (s.cadence === "weekly") {
    const days = (s.weekdays && s.weekdays.length > 0 ? s.weekdays : [1, 2, 3, 4, 5, 6, 0])
      .map((n) => ((n % 7) + 7) % 7)
      .sort((a, b) => a - b);
    for (let i = 1; i <= 14; i++) {
      const cand = new Date(base);
      cand.setDate(cand.getDate() + i);
      const hit = build(cand);
      if (days.includes(hit.getDay()) && hit.getTime() > from.getTime()) return hit;
    }
  }
  // daily default
  const today = build(base);
  if (today.getTime() > from.getTime() + 60_000) return today;
  const tmr = new Date(today);
  tmr.setDate(tmr.getDate() + 1);
  return tmr;
}

/** Tages-Schlüssel (lokal) — sorgt dafür, dass die Mischung pro Tag stabil bleibt. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Deterministisches Mischen anhand eines Seeds (gleicher Seed = gleiche Reihenfolge). */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
