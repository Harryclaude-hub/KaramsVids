// ============================================================
// Auto-Antworten: neue Kommentare / DMs abholen und beantworten.
// Aktuell für Meta (Instagram + Facebook) über die Graph-API —
// TikTok & YouTube bieten dafür keine offene Schreib-API bzw.
// erst nach eigenem Audit.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { refreshIfNeeded } from "./social-oauth.server";

export type Rule = {
  id: string;
  user_id: string;
  brand_id: string;
  platform: string;
  trigger_type: "new_follower" | "comment" | "dm";
  keyword: string | null;
  message_template: string;
  delay_minutes: number;
  active: boolean;
};

function render(tpl: string, vars: { name?: string; brand?: string }): string {
  return tpl
    .replaceAll("{name}", vars.name ?? "")
    .replaceAll("{brand}", vars.brand ?? "")
    .trim();
}

function matches(rule: Rule, text: string): boolean {
  if (!rule.keyword) return true;
  return text.toLowerCase().includes(rule.keyword.toLowerCase());
}

/** Ein Brand + eine Plattform abarbeiten. Gibt Anzahl gesendeter Antworten zurück. */
export async function runAutomationsForAccount(
  supabaseAdmin: any,
  account: any,
  brandName: string,
  rules: Rule[],
): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  const platform = account.platform as string;
  if (platform !== "instagram" && platform !== "facebook") {
    return {
      sent: 0,
      errors: [
        `${platform}: Auto-Antworten benötigen eine offene Schreib-API — aktuell nur Meta unterstützt.`,
      ],
    };
  }

  const token = await refreshIfNeeded(supabaseAdmin, account);
  const nodeId = platform === "instagram" ? account.meta?.ig_user_id : account.meta?.page_id;
  if (!nodeId) return { sent: 0, errors: [`${platform}: Account-ID fehlt — bitte neu verbinden.`] };

  const commentRules = rules.filter((r) => r.trigger_type === "comment" && r.active);
  if (commentRules.length === 0) return { sent: 0, errors };

  // Letzte Medien holen und deren neue Kommentare beantworten
  const mediaEdge = platform === "instagram" ? "media" : "posts";
  const mres = await fetch(
    `https://graph.facebook.com/v21.0/${nodeId}/${mediaEdge}?limit=5&access_token=${token}`,
  );
  const mjson: any = await mres.json();
  if (!mres.ok || mjson.error) {
    return { sent: 0, errors: [`${platform}: ${mjson.error?.message ?? mres.status}`] };
  }

  for (const media of mjson.data ?? []) {
    const cres = await fetch(
      `https://graph.facebook.com/v21.0/${media.id}/comments?fields=id,text,message,username,from,timestamp&limit=25&access_token=${token}`,
    );
    const cjson: any = await cres.json();
    if (!cres.ok || cjson.error) continue;

    for (const c of cjson.data ?? []) {
      const text: string = c.text ?? c.message ?? "";
      const who: string = c.username ?? c.from?.name ?? "";

      // Schon beantwortet?
      const { data: seen } = await supabaseAdmin
        .from("automation_events")
        .select("id")
        .eq("brand_id", account.brand_id)
        .eq("platform", platform)
        .eq("target_handle", `${c.id}`)
        .maybeSingle();
      if (seen) continue;

      const rule = commentRules.find((r) => matches(r, text));
      if (!rule) continue;

      const body = render(rule.message_template, { name: who, brand: brandName });
      let status = "sent";
      let error: string | null = null;
      try {
        const rres = await fetch(`https://graph.facebook.com/v21.0/${c.id}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: body, access_token: token }),
        });
        const rjson: any = await rres.json();
        if (!rres.ok || rjson.error) throw new Error(rjson.error?.message ?? `HTTP ${rres.status}`);
        sent++;
      } catch (e) {
        status = "failed";
        error = e instanceof Error ? e.message : String(e);
        errors.push(error);
      }

      await supabaseAdmin.from("automation_events").insert({
        user_id: rule.user_id,
        brand_id: rule.brand_id,
        rule_id: rule.id,
        platform,
        trigger_type: "comment",
        target_handle: `${c.id}`,
        message_sent: body,
        status,
        error,
      });
    }
  }

  return { sent, errors };
}
