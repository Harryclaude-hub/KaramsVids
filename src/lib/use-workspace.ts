import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useState } from "react";

const LS_KEY = "vc:activeWorkspaceId";

export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  avatar_path: string | null;
  payout_provider: string | null;
  payout_details: Record<string, unknown>;
  notes: string | null;
  created_at: string;
};

export type AffiliateProgram = {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  link: string;
  payout_type: string;
  payout_amount: number;
  currency: string;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type Earning = {
  id: string;
  user_id: string;
  workspace_id: string;
  brand_id: string | null;
  affiliate_program_id: string | null;
  platform: string | null;
  source: string;
  amount: number;
  currency: string;
  views: number;
  status: string;
  period_start: string | null;
  period_end: string | null;
  note: string | null;
  created_at: string;
};

/** Alle Profile des eingeloggten Users. */
export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Workspace[];
    },
  });
}

/** Merkt das aktive Profil im Browser. */
export function useActiveWorkspaceId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LS_KEY);
  });
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setId(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const set = useCallback((v: string | null) => {
    if (typeof window !== "undefined") {
      if (v) window.localStorage.setItem(LS_KEY, v);
      else window.localStorage.removeItem(LS_KEY);
    }
    setId(v);
  }, []);
  return [id, set];
}

/**
 * Sorgt dafür, dass immer genau ein Profil aktiv ist: legt beim ersten
 * Login automatisch „Mein Profil" an und wählt es aus.
 */
export function useEnsureWorkspace(userId: string) {
  const qc = useQueryClient();
  const wsQ = useWorkspaces();
  const [activeId, setActiveId] = useActiveWorkspaceId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wsQ.isLoading || busy) return;
    const list = wsQ.data ?? [];
    if (list.length === 0) {
      setBusy(true);
      supabase
        .from("workspaces")
        .insert({ user_id: userId, name: "Mein Profil" } as never)
        .select()
        .single()
        .then(({ data }) => {
          setBusy(false);
          if (data) {
            qc.invalidateQueries({ queryKey: ["workspaces"] });
            setActiveId((data as { id: string }).id);
          }
        });
      return;
    }
    if (!activeId || !list.some((w) => w.id === activeId)) setActiveId(list[0].id);
  }, [wsQ.isLoading, wsQ.data, activeId, setActiveId, qc, userId, busy]);

  const workspaces = wsQ.data ?? [];
  return {
    workspaces,
    activeWorkspaceId: activeId,
    setActiveWorkspaceId: setActiveId,
    activeWorkspace: workspaces.find((w) => w.id === activeId) ?? null,
    isLoading: wsQ.isLoading,
  };
}

export async function createWorkspace(userId: string, name: string, color = "#F26A1F") {
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ user_id: userId, name, color } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Workspace;
}

/** Affiliate-Programme eines Profils. */
export function useAffiliatePrograms(workspaceId: string | null) {
  return useQuery({
    queryKey: ["affiliate_programs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("affiliate_programs")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AffiliateProgram[];
    },
  });
}

/** Einnahmen eines Profils. */
export function useEarnings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["earnings", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("earnings")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Earning[];
    },
  });
}

/** Hängt den Affiliate-Link an eine Caption an (falls noch nicht enthalten). */
export function withAffiliateLink(caption: string | null | undefined, link?: string | null) {
  const base = (caption ?? "").trim();
  if (!link) return base;
  if (base.includes(link)) return base;
  return [base, link].filter(Boolean).join("\n\n");
}
