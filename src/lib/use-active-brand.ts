import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState, useCallback } from "react";

const LS_KEY = "vc:activeBrandId";

export type Brand = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
};

export function useBrands(userId: string) {
  return useQuery({
    queryKey: ["brands", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .order("created_at", { ascending: true });
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
  return async (name: string, color = "#F26A1F") => {
    const { data, error } = await supabase
      .from("brands")
      .insert({ user_id: userId, name, color })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["brands", userId] });
    return data as Brand;
  };
}

/**
 * Modal-artiger Helfer: gibt garantiert eine Brand-ID zurück oder wirft.
 * Wird von Upload/Editor genutzt, damit jedes Video zu einem Brand gehört.
 */
export function useRequireBrand() {
  const [activeBrandId, setActiveBrandId] = useActiveBrandId();
  return { activeBrandId, setActiveBrandId };
}
