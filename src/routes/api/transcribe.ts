import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabasePub = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient(supabaseUrl, supabasePub, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: userData } = await supabase.auth.getUser(token);
        if (!userData.user) return new Response("Unauthorized", { status: 401 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return new Response("file required", { status: 400 });

        // Match extension to real MIME type so OpenAI's format inference doesn't reject.
        const mime = (file.type.split(";")[0] || "").toLowerCase();
        const ext = ({
          "audio/webm": "webm",
          "audio/ogg": "webm",
          "audio/mp4": "mp4",
          "audio/mpeg": "mp3",
          "audio/wav": "wav",
          "audio/x-wav": "wav",
        } as Record<string, string>)[mime] ?? "webm";

        const upstream = new FormData();
        upstream.append("file", file, `recording.${ext}`);
        upstream.append("model", "openai/gpt-4o-transcribe");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });
        const text = await res.text();
        return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
