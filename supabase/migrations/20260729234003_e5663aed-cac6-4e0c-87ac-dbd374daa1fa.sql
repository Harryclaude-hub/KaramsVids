CREATE TABLE public.render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  brand_id uuid,
  workspace_id uuid,
  clip_index integer NOT NULL DEFAULT 0,
  template_id text NOT NULL DEFAULT 'ugc_hook',
  provider text NOT NULL DEFAULT 'creatomate',
  provider_render_id text,
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  source_url text,
  start_s numeric NOT NULL DEFAULT 0,
  end_s numeric NOT NULL DEFAULT 0,
  aspect text NOT NULL DEFAULT '9:16',
  title text,
  captions_srt text,
  music_url text,
  music_volume numeric NOT NULL DEFAULT 0.18,
  output_url text,
  storage_path text,
  clip_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX render_jobs_user_status_idx ON public.render_jobs (user_id, status);
CREATE INDEX render_jobs_job_idx ON public.render_jobs (job_id, clip_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_jobs TO authenticated;
GRANT ALL ON public.render_jobs TO service_role;

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "render_jobs owner all" ON public.render_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER render_jobs_set_updated_at
  BEFORE UPDATE ON public.render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();