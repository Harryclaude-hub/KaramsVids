import { createFileRoute } from "@tanstack/react-router";

// POST /api/worker/upload-url
//
// Gibt dem Worker eine signierte Upload-URL fuer einen fertigen Clip. Der
// Pfad ist fest vorgegeben: {user_id}/{jobId}/{n}.mp4 im Bucket
// rendered-clips. Eine Datei, die dort schon liegt, wird vorher entfernt,
// damit erneutes Anstossen sauber ueberschreibt.
//
// Rumpf:   { jobId, workerId, n: number, ext: "mp4" }
// Antwort: { ok:true, path, token, signedUrl }

const BUCKET = "rendered-clips";

export const Route = createFileRoute("/api/worker/upload-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { prepareJobRequest, json, readNumber, readNullableString, failureText } =
          await import("@/lib/worker-api.server");

        const prepared = await prepareJobRequest(request);
        if (!prepared.ok) return prepared.response;
        const { admin, job, body } = prepared;

        const n = readNumber(body, "n");
        if (n === null || !Number.isInteger(n) || n < 0) {
          return json({ ok: false, error: "n muss eine ganze Zahl ab 0 sein" }, 400);
        }

        const ext = readNullableString(body, "ext") ?? "mp4";
        if (ext !== "mp4") return json({ ok: false, error: "ext muss mp4 sein" }, 400);

        const path = `${job.user_id}/${job.id}/${n}.${ext}`;

        try {
          // Alte Datei am selben Pfad wegraeumen. Fehlt sie, ist das in
          // Ordnung, deshalb wird das Ergebnis hier nicht geprueft.
          await admin.storage.from(BUCKET).remove([path]);

          const { data, error } = await admin.storage
            .from(BUCKET)
            .createSignedUploadUrl(path, { upsert: true });

          if (error || !data?.signedUrl) {
            return json(
              {
                ok: false,
                error: "Upload-URL fehlgeschlagen: " + (error?.message ?? "keine URL erhalten"),
              },
              500,
            );
          }

          return json({
            ok: true,
            path: data.path ?? path,
            token: data.token,
            signedUrl: data.signedUrl,
          });
        } catch (e) {
          return json({ ok: false, error: failureText(e, "Upload-URL fehlgeschlagen") }, 500);
        }
      },
    },
  },
});
