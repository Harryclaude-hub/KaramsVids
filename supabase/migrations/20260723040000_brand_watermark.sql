-- Wasserzeichen pro Brand: Logo-Bild, Standard an/aus, Ecken-Position
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS watermark_path text,
  ADD COLUMN IF NOT EXISTS watermark_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watermark_position text NOT NULL DEFAULT 'br'; -- tl|tr|bl|br
