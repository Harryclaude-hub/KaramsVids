
ALTER TABLE public.generated_clips
  ADD COLUMN IF NOT EXISTS transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS overlays jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audio_tracks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.edit_jobs
  ADD COLUMN IF NOT EXISTS timeline_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS desired_clip_count integer;
