import { createFileRoute } from "@tanstack/react-router";

// POST /api/worker/analysis
//
// Legt den Schnittplan des Workers in edit_jobs.analysis ab, aber nur wenn
// dort noch nichts steht. Das Update ist bedingt (analysis is null), damit
// zwei Versuche nicht doch noch uebereinander schreiben. Steht schon etwas
// drin, bleibt es unveraendert und die Antwort meldet skipped.
//
// Der Status bleibt bewusst auf analyzing, damit die Oberflaeche weiter
// nachlaedt und die Clips beim Rendern auftauchen sieht.
//
// Rumpf:   { jobId, workerId, analysis: object }
// Antwort: { ok:true } oder { ok:true, skipped:true }

export const Route = createFileRoute("/api/worker/analysis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { prepareJobRequest, json, readObject, asJson, failureText } =
          await import("@/lib/worker-api.server");

        const prepared = await prepareJobRequest(request);
        if (!prepared.ok) return prepared.response;
        const { admin, job, body } = prepared;

        const analysis = readObject(body, "analysis");
        if (!analysis) return json({ ok: false, error: "analysis muss ein Objekt sein" }, 400);

        // Schon gefuellt: nichts anfassen.
        if (job.analysis !== null && job.analysis !== undefined) {
          return json({ ok: true, skipped: true });
        }

        try {
          const { data, error } = await admin
            .from("edit_jobs")
            .update({ analysis: asJson(analysis) })
            .eq("id", job.id)
            .is("analysis", null)
            .select("id");

          if (error) {
            return json({ ok: false, error: "Analyse nicht gespeichert: " + error.message }, 500);
          }
          // Leere Antwort: zwischenzeitlich hat jemand anders geschrieben.
          if (!data || data.length === 0) return json({ ok: true, skipped: true });

          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Analyse fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
