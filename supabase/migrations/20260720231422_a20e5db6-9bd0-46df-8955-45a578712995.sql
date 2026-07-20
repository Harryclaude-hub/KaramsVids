
-- Folders
CREATE TABLE public.folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "folders owner all" ON public.folders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER folders_updated_at BEFORE UPDATE ON public.folders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX folders_brand_idx ON public.folders(brand_id);

-- Extend raw_videos
ALTER TABLE public.raw_videos
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform TEXT;
CREATE INDEX IF NOT EXISTS raw_videos_folder_idx ON public.raw_videos(folder_id);

-- Extend social_accounts
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_error TEXT;

-- Analytics snapshots (cache)
CREATE TABLE public.analytics_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_snapshots TO authenticated;
GRANT ALL ON public.analytics_snapshots TO service_role;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analytics_snapshots owner all" ON public.analytics_snapshots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX analytics_snap_brand_idx ON public.analytics_snapshots(brand_id, snapshot_at DESC);
CREATE INDEX analytics_snap_account_idx ON public.analytics_snapshots(social_account_id, snapshot_at DESC);

-- Enable extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
