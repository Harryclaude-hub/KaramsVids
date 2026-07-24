
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS avatar_path text,
  ADD COLUMN IF NOT EXISTS watermark_path text,
  ADD COLUMN IF NOT EXISTS watermark_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watermark_position text NOT NULL DEFAULT 'br',
  ADD COLUMN IF NOT EXISTS name_font text NOT NULL DEFAULT 'sans';
