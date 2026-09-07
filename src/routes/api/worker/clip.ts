import { createFileRoute } from "@tanstack/react-router";

// POST /api/worker/clip
//
// Traegt einen fertigen Clip in generated_clips ein. user_id und brand_id
// kommen vom Auftrag, nie aus dem Rumpf, damit ein Worker keine Zeilen bei
// fremden Nutzern anlegen kann. meta bekommt immer engine:'worker', daran
// erkennt reset-clips spaeter, was es loeschen darf.
//
// Rumpf:   { jobId, workerId, storage_path, title, duration_s, caption_srt, aspect, meta }
// Antwort: { ok:true, clipId }

export const Route = createFileRoute("/api/worker/clip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          prepareJobRequest,
          json,
          readString,
          readNullableString,
          readNumber,
          readObject,
          asJson,
          failureText,
        } = await import("@/lib/worker-api.server");

        const prepared = await prepareJobRequest(request);
        if (!prepared.ok) return prepared.response;
        const { admin, job, body } = prepared;

        const storagePath = readString(body, "storage_path");
        if (!storagePath) return json({ ok: false, error: "storage_path fehlt" }, 400);

        const title = readNullableString(body, "title");
        const durationS = readNumber(body, "duration_s");
        const captionSrt = readNullableString(body, "caption_srt");
        const aspect = readString(body, "aspect") ?? "9:16";
        const meta = readObject(body, "meta") ?? {};

        try {
          const { data, error } = await admin
            .from("generated_clips")
            .insert({
              user_id: job.user_id,
              job_id: job.id,
              brand_id: job.brand_id,
              storage_path: storagePath,
              aspect,
              duration_s: durationS,
              title: title ? title.slice(0, 200) : null,
              caption_srt: captionSrt,
              meta: asJson({ ...meta, engine: "worker" }),
            })
            .select("id")
            .single();

          if (error || !data) {
            return json(
              {
                ok: false,
                error: "Clip nicht gespeichert: " + (error?.message ?? "keine Zeile zurueck"),
              },
              500,
            );
          }

          return json({ ok: true, clipId: data.id });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Clip fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
