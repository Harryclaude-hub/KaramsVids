
-- Enums
CREATE TYPE public.edit_mode AS ENUM ('auto_cut','ugc_shorts','long_to_many','manual');
CREATE TYPE public.job_status AS ENUM ('pending','analyzing','ready','rendering','done','failed');
CREATE TYPE public.social_platform AS ENUM ('tiktok','youtube','instagram','facebook','x');

-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles self upsert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- raw_videos
CREATE TABLE public.raw_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_url text,
  storage_path text,
  duration_s numeric,
  size_bytes bigint,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_videos TO authenticated;
GRANT ALL ON public.raw_videos TO service_role;
ALTER TABLE public.raw_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_videos owner all" ON public.raw_videos FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- edit_jobs
CREATE TABLE public.edit_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_video_id uuid NOT NULL REFERENCES public.raw_videos(id) ON DELETE CASCADE,
  mode public.edit_mode NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.job_status NOT NULL DEFAULT 'pending',
  progress int NOT NULL DEFAULT 0,
  analysis jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_jobs TO authenticated;
GRANT ALL ON public.edit_jobs TO service_role;
ALTER TABLE public.edit_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edit_jobs owner all" ON public.edit_jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- generated_clips
CREATE TABLE public.generated_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.edit_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  aspect text NOT NULL DEFAULT '9:16',
  duration_s numeric,
  title text,
  caption_srt text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_clips TO authenticated;
GRANT ALL ON public.generated_clips TO service_role;
ALTER TABLE public.generated_clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "generated_clips owner all" ON public.generated_clips FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- social_accounts
CREATE TABLE public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform public.social_platform NOT NULL,
  handle text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "social_accounts owner all" ON public.social_accounts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.edit_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
