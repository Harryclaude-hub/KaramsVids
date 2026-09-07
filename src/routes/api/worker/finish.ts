import { createFileRoute } from "@tanstack/react-router";

// POST /api/worker/finish
//
// Schliesst einen Auftrag ab. Bei done wird progress auf 100 gesetzt und ein
// alter Fehlertext geloescht. Bei failed bleibt der Fortschritt stehen, damit
// man sieht, wie weit der Worker gekommen ist. options.worker_id bleibt in
// beiden Faellen erhalten; erneutes Anstossen aus der App setzt ihn zurueck.
//
// Rumpf:   { jobId, workerId, status: "done"|"failed", error? }
// Antwort: { ok:true }

export const Route = createFileRoute("/api/worker/finish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          prepareJobRequest,
          json,
          readString,
          readNullableString,
          asJson,
          touchedOptions,
          failureText,
        } = await import("@/lib/worker-api.server");

        const prepared = await prepareJobRequest(request);
        if (!prepared.ok) return prepared.response;
        const { admin, job, body } = prepared;

        const status = readString(body, "status");
        if (status !== "done" && status !== "failed") {
          return json({ ok: false, error: "status muss done oder failed sein" }, 400);
        }

        const failureMessage = (readNullableString(body, "error") ?? "").trim();

        const patch =
          status === "done"
            ? {
                status: "done" as const,
                progress: 100,
                error: null,
                options: asJson(touchedOptions(job.options, { worker_phase: "fertig" })),
              }
            : {
                status: "failed" as const,
                error: (failureMessage || "Der Worker hat den Auftrag abgebrochen").slice(0, 4000),
                options: asJson(touchedOptions(job.options, { worker_phase: "fehlgeschlagen" })),
              };

        try {
          const { error } = await admin.from("edit_jobs").update(patch).eq("id", job.id);
          if (error) {
            return json({ ok: false, error: "Abschluss nicht gespeichert: " + error.message }, 500);
          }
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Abschluss fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
