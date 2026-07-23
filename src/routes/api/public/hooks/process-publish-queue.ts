import { createFileRoute } from "@tanstack/react-router";

// pg_cron ruft das alle 5 Minuten. Für jeden aktiven Zeitplan, dessen
// next_run_at erreicht ist: schnappe die nächsten N Clips aus der Warteschlange
// (status='queued', gleicher brand + platform, sortiert nach queue_position),
// versuche zu publishen (aktuell simuliert – echte Plattform-Uploads brauchen
// die noch nicht bereitgestellten Provider-Keys) und berechne next_run_at neu.

export const Route = createFileRoute("/api/public/hooks/process-publish-queue")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();

        const { data: schedules, error: schErr } = await supabaseAdmin
          .from("publish_schedules")
          .select("*")
          .eq("active", true)
          .lte("next_run_at", now.toISOString());
        if (schErr) {
          return json({ ok: false, error: schErr.message }, 500);
        }

        let published = 0;
        const details: Array<Record<string, unknown>> = [];

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

            let pickedTotal = 0;
            for (const platform of platformList) {
            const { data: clips, error: clipErr } = await supabaseAdmin
              .from("generated_clips")
              .select("*")
              .eq("brand_id", s.brand_id)
              .eq("platform", platform)
              .eq("status", "queued")
              .order("queue_position", { ascending: true })
              .limit(s.videos_per_slot);
            if (clipErr) throw new Error(clipErr.message);

            const { data: acc } = await supabaseAdmin
              .from("social_accounts")
              .select("id,status,handle")
              .eq("brand_id", s.brand_id)
              .eq("platform", platform as "tiktok" | "youtube" | "instagram" | "facebook" | "x")
              .neq("status", "disconnected")
              .maybeSingle();

            for (const c of clips ?? []) {
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
              } else {
                // TODO: echte Plattform-Upload-Calls, sobald API-Keys vorliegen
                await supabaseAdmin
                  .from("generated_clips")
                  .update({
                    status: "published",
                    scheduled_for: publishedAt,
                    published_at: publishedAt,
                    published_url: null,
                    publish_error: "Simulierter Upload – wartet auf offizielle API-Freigabe",
                  })
                  .eq("id", c.id);
                published++;
              }
            }
            pickedTotal += (clips ?? []).length;
            } // Ende Plattform-Schleife

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
              brand_id: s.brand_id,
              platforms: platformList,
              picked: pickedTotal,
              next_run_at: nextRun.toISOString(),
            });
          } catch (e) {
            details.push({ schedule_id: s.id, error: e instanceof Error ? e.message : String(e) });
          }
        }

        return json({ ok: true, published, schedules_processed: schedules?.length ?? 0, details });
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Schedule = {
  cadence: string;
  weekdays: number[] | null;
  time_of_day: string; // 'HH:MM:SS' or 'HH:MM'
  interval_minutes?: number | null;
};

function computeNextRun(s: Schedule, from: Date): Date {
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
