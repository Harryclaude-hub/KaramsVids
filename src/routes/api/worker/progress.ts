import { createFileRoute } from "@tanstack/react-router";

// POST /api/worker/progress
//
// Fortschrittsmeldung des Workers. Setzt edit_jobs.progress und merkt sich
// Phase und Herzschlag in options, damit die Oberflaeche sieht, dass der
// Rechner noch arbeitet.
//
// Rumpf:   { jobId, workerId, progress: 0..100, phase }
// Antwort: { ok:true }

export const Route = createFileRoute("/api/worker/progress")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          prepareJobRequest,
          json,
          readNumber,
          readString,
          asJson,
          touchedOptions,
          clampProgress,
          failureText,
        } = await import("@/lib/worker-api.server");

        const prepared = await prepareJobRequest(request);
        if (!prepared.ok) return prepared.response;
        const { admin, job, body } = prepared;

        const rawProgress = readNumber(body, "progress");
        if (rawProgress === null) return json({ ok: false, error: "progress fehlt" }, 400);
        const phase = readString(body, "phase");
        if (!phase) return json({ ok: false, error: "phase fehlt" }, 400);

        try {
          const { error } = await admin
            .from("edit_jobs")
            .update({
              progress: clampProgress(rawProgress),
              options: asJson(touchedOptions(job.options, { worker_phase: phase })),
            })
            .eq("id", job.id);

          if (error) {
            return json(
              { ok: false, error: "Fortschritt nicht gespeichert: " + error.message },
              500,
            );
          }
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Fortschritt fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
