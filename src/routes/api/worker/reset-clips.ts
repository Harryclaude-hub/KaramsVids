import { createFileRoute } from "@tanstack/react-router";

// POST /api/worker/reset-clips
//
// Raeumt die Clips eines Auftrags weg, bevor der Worker ihn neu bearbeitet.
// Geloescht wird nur, was der Worker selbst angelegt hat (meta.engine =
// worker); von Hand oder ueber andere Wege erzeugte Clips bleiben stehen.
//
// Rumpf:   { jobId, workerId }
// Antwort: { ok:true, deleted: n }

export const Route = createFileRoute("/api/worker/reset-clips")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { prepareJobRequest, json, failureText } = await import("@/lib/worker-api.server");

        const prepared = await prepareJobRequest(request);
        if (!prepared.ok) return prepared.response;
        const { admin, job } = prepared;

        try {
          const { data, error } = await admin
            .from("generated_clips")
            .delete()
            .eq("job_id", job.id)
            .eq("meta->>engine", "worker")
            .select("id");

          if (error) {
            return json({ ok: false, error: "Clips nicht geloescht: " + error.message }, 500);
          }

          return json({ ok: true, deleted: data?.length ?? 0 });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Loeschen fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
