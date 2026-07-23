import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Modul-weiter Cache, damit Sidebar/Header nicht ständig neue Signed-URLs holen
const urlCache = new Map<string, string>();

export type BrandLike = {
  id: string;
  name: string;
  color: string;
  avatar_path?: string | null;
};

export function BrandAvatar({
  brand,
  className = "h-6 w-6 rounded-md",
}: {
  brand: BrandLike;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(
    brand.avatar_path ? (urlCache.get(brand.avatar_path) ?? null) : null,
  );

  useEffect(() => {
    const path = brand.avatar_path;
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(path);
    if (cached) {
      setUrl(cached);
      return;
    }
    let alive = true;
    supabase.storage
      .from("raw-videos")
      .createSignedUrl(path, 3600 * 12)
      .then(({ data }) => {
        if (data?.signedUrl && alive) {
          urlCache.set(path, data.signedUrl);
          setUrl(data.signedUrl);
        }
      });
    return () => {
      alive = false;
    };
  }, [brand.avatar_path]);

  if (url) {
    return <img src={url} alt={brand.name} className={`${className} object-cover`} />;
  }
  return (
    <span
      className={`${className} grid place-items-center text-[0.6em] font-semibold text-white`}
      style={{ background: brand.color }}
    >
      {brand.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
