ALTER TABLE public.edit_jobs
  ADD COLUMN IF NOT EXISTS chat_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS style_reference jsonb;