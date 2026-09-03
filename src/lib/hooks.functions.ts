// ============================================================
// „Jetzt ausführen"-Aktionen aus der Oberfläche.
//
// Früher hat das Frontend direkt /api/public/hooks/* per fetch
// aufgerufen. Diese Endpunkte laufen mit der Service-Role über ALLE
// Nutzer hinweg, sie gehören dem Cron, nicht dem Browser.
//
// Diese Server-Funktionen prüfen die Anmeldung und schränken die
// Verarbeitung auf die Daten des angemeldeten Nutzers ein.
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Fällige Publishing-Slots des angemeldeten Nutzers sofort abarbeiten. */
export const runPublishQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processPublishQueue } = await import("@/lib/publish-queue.server");
    return processPublishQueue(supabaseAdmin, new Date(), context.userId);
  });

/** Analytics-Snapshots für die Accounts des angemeldeten Nutzers erzeugen. */
export const runAnalyticsSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncAnalytics } = await import("@/lib/analytics-sync.server");
    return syncAnalytics(supabaseAdmin, context.userId);
  });
