import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState, useCallback } from "react";
import { useActiveWorkspaceId } from "@/lib/use-workspace";

const LS_KEY = "vc:activeBrandId";

export type Brand = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  avatar_path?: string | null;
  workspace_id?: string | null;
  created_at: string;
};

/** Brands des aktiven Profils (Profile sind strikt getrennt). */
export function useBrands(userId: string) {
  const [workspaceId] = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["brands", userId, workspaceId],
    queryFn: async () => {
      let q = supabase.from("brands").select("*").order("created_at", { ascending: true });
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Brand[];
    },
  });
}

export function useActiveBrandId(): [string | null, (id: string | null) => void] {
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

export function useCreateBrand(userId: string) {
  const qc = useQueryClient();
  const [workspaceId] = useActiveWorkspaceId();
  return async (name: string, color = "#F26A1F") => {
    const { data, error } = await supabase
      .from("brands")
      .insert({ user_id: userId, name, color, workspace_id: workspaceId } as never)
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["brands"] });
    return data as Brand;
  };
}
