import { createFileRoute } from "@tanstack/react-router";
// Nur Typen, wird beim Bauen entfernt und landet nicht im Client-Bundle.
import type { WorkerJob } from "@/lib/worker-api.server";

// POST /api/worker/claim
//
// Der Worker fragt nach Arbeit. Gesucht wird der aelteste Auftrag mit
// status = analyzing, options.engine = worker und noch leerem
// options.worker_id. Beansprucht wird er mit EINEM bedingten Update
// (worker_id muss noch leer sein). Kommt keine Zeile zurueck, war ein anderer
// Worker schneller und der naechste Kandidat ist dran.
//
// Rumpf:    { workerId }
// Antwort:  { ok:true, job, source, storage }  oder  { ok:true, job:null }
//
// source.kind = "storage": signierte Download-URL (3 h) aus raw-videos
// source.kind = "url":     raw_videos.source_url, der Worker laedt selbst

export const Route = createFileRoute("/api/worker/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          checkWorkerSecret,
          readJsonBody,
          readString,
          json,
          getAdmin,
          asJson,
          nowIso,
          publicStorageConfig,
          JOB_COLUMNS,
          toJob,
          failureText,
        } = await import("@/lib/worker-api.server");

        const denied = checkWorkerSecret(request);
        if (denied) return denied;

        const body = await readJsonBody(request);
        if (!body) return json({ ok: false, error: "Rumpf muss ein JSON-Objekt sein" }, 400);

        const workerId = readString(body, "workerId");
        if (!workerId) return json({ ok: false, error: "workerId fehlt" }, 400);

        const storage = publicStorageConfig();
        if (!storage) {
          return json(
            { ok: false, error: "SUPABASE_URL oder SUPABASE_PUBLISHABLE_KEY fehlt" },
            503,
          );
        }

        try {
          const admin = await getAdmin();

          /** Anspruch zurueckgeben, damit ein Auftrag nicht haengen bleibt. */
          const releaseClaim = async (job: WorkerJob) => {
            await admin
              .from("edit_jobs")
              .update({
                options: asJson({
                  ...job.options,
                  worker_id: null,
                  worker_phase: "wieder frei",
                  worker_heartbeat: nowIso(),
                }),
              })
              .eq("id", job.id);
          };

          // Mehrere Kandidaten holen, damit ein verlorenes Rennen nicht sofort
          // in "keine Arbeit" endet.
          const { data: candidates, error: listErr } = await admin
            .from("edit_jobs")
            .select(JOB_COLUMNS)
            .eq("status", "analyzing")
            .eq("options->>engine", "worker")
            .is("options->>worker_id", null)
            .order("created_at", { ascending: true })
            .limit(10);

          if (listErr) {
            return json(
              { ok: false, error: "Auftraege konnten nicht gelesen werden: " + listErr.message },
              500,
            );
          }

          for (const row of candidates ?? []) {
            const candidate = toJob(row as unknown as Record<string, unknown>);
            const nextOptions = {
              ...candidate.options,
              worker_id: workerId,
              worker_phase: "beansprucht",
              worker_heartbeat: nowIso(),
            };

            // Bedingtes Update: greift nur, solange worker_id leer ist.
            const { data: claimedRows, error: claimErr } = await admin
              .from("edit_jobs")
              .update({ options: asJson(nextOptions) })
              .eq("id", candidate.id)
              .is("options->>worker_id", null)
              .select(JOB_COLUMNS);

            if (claimErr) {
              return json(
                {
                  ok: false,
                  error: "Auftrag konnte nicht beansprucht werden: " + claimErr.message,
                },
                500,
              );
            }
            // Leere Antwort: ein anderer Worker war schneller.
            if (!claimedRows || claimedRows.length === 0) continue;

            const job = toJob(claimedRows[0] as unknown as Record<string, unknown>);

            const { data: raw, error: rawErr } = await admin
              .from("raw_videos")
              .select("storage_path, source_url, title, duration_s")
              .eq("id", job.raw_video_id)
              .maybeSingle();

            if (rawErr) {
              await releaseClaim(job);
              return json(
                { ok: false, error: "Quelle konnte nicht gelesen werden: " + rawErr.message },
                500,
              );
            }

            // Ohne Quelle ist der Auftrag dauerhaft unbrauchbar. Er wird
            // abgeschlossen statt freigegeben, sonst dreht der Worker im Kreis.
            if (!raw || (!raw.storage_path && !raw.source_url)) {
              await admin
                .from("edit_jobs")
                .update({
                  status: "failed",
                  error: "Quelle fehlt: weder storage_path noch source_url gesetzt",
                  options: asJson({
                    ...job.options,
                    worker_phase: "fehlgeschlagen",
                    worker_heartbeat: nowIso(),
                  }),
                })
                .eq("id", job.id);
              continue;
            }

            const title = raw.title ?? null;
            const durationS = raw.duration_s ?? null;
            let source: {
              kind: "storage" | "url";
              url: string;
              title: string | null;
              duration_s: number | null;
            };

            if (raw.storage_path) {
              const { data: signed, error: signErr } = await admin.storage
                .from("raw-videos")
                .createSignedUrl(raw.storage_path, 60 * 60 * 3);

              if (signErr || !signed?.signedUrl) {
                // Vermutlich voruebergehend, deshalb den Anspruch zurueckgeben.
                await releaseClaim(job);
                return json(
                  {
                    ok: false,
                    error:
                      "Signierte Quell-URL fehlgeschlagen: " +
                      (signErr?.message ?? "keine URL erhalten"),
                  },
                  500,
                );
              }
              source = { kind: "storage", url: signed.signedUrl, title, duration_s: durationS };
            } else {
              source = { kind: "url", url: raw.source_url as string, title, duration_s: durationS };
            }

            return json({
              ok: true,
              job: {
                id: job.id,
                user_id: job.user_id,
                mode: job.mode,
                options: job.options,
                analysis: job.analysis,
                created_at: job.created_at,
              },
              source,
              storage,
            });
          }

          return json({ ok: true, job: null });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Beanspruchen fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
