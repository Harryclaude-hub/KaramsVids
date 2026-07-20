
CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#F26A1F',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands owner all" ON public.brands FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.raw_videos ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;
ALTER TABLE public.edit_jobs ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;
ALTER TABLE public.social_accounts ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;
CREATE INDEX raw_videos_brand_id_idx ON public.raw_videos(brand_id);
CREATE INDEX edit_jobs_brand_id_idx ON public.edit_jobs(brand_id);
CREATE INDEX social_accounts_brand_id_idx ON public.social_accounts(brand_id);
