ALTER TABLE public.render_jobs
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS render_seconds numeric,
  ADD COLUMN IF NOT EXISTS cost_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thumbnail_path text,
  ADD COLUMN IF NOT EXISTS audio_path text,
  ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz;

CREATE TABLE IF NOT EXISTS public.render_template_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  base_template_id text NOT NULL DEFAULT 'ugc_hook',
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_template_presets TO authenticated;
GRANT ALL ON public.render_template_presets TO service_role;
ALTER TABLE public.render_template_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "render_template_presets owner all" ON public.render_template_presets;
CREATE POLICY "render_template_presets owner all" ON public.render_template_presets
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS render_template_presets_updated_at ON public.render_template_presets;
CREATE TRIGGER render_template_presets_updated_at BEFORE UPDATE ON public.render_template_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();