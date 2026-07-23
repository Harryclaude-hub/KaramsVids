-- ============================================================
-- Studio-Bereiche: KI-Generierung (Storylines mit Gedächtnis),
-- Menschen-/Avatar-Generierung + Overlap, Generierungs-Jobs
-- ============================================================

-- Storylines: pro Brand, mit persistentem Gedächtnis (memory jsonb)
CREATE TABLE IF NOT EXISTS public.storylines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title text NOT NULL,
  premise text,                       -- Grundidee / Logline
  style jsonb NOT NULL DEFAULT '{}'::jsonb,   -- Look, Ton, Musikrichtung, Aspect
  memory jsonb NOT NULL DEFAULT '{"events":[],"facts":[]}'::jsonb, -- Story-Gedächtnis
  episode_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storylines TO authenticated;
GRANT ALL ON public.storylines TO service_role;
ALTER TABLE public.storylines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "storylines owner all" ON public.storylines
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER storylines_updated_at BEFORE UPDATE ON public.storylines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS storylines_brand_idx ON public.storylines(brand_id);

-- Charaktere: wiederkehrende Figuren einer Storyline (Konsistenz über Episoden)
CREATE TABLE IF NOT EXISTS public.storyline_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storyline_id uuid NOT NULL REFERENCES public.storylines(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,                   -- Aussehen, Persönlichkeit, Stimme
  visual_ref text,                    -- Storage-Pfad oder URL eines Referenzbilds
  voice_ref text,                     -- TTS-Voice-ID des Providers
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storyline_characters TO authenticated;
GRANT ALL ON public.storyline_characters TO service_role;
ALTER TABLE public.storyline_characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "storyline_characters owner all" ON public.storyline_characters
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS storyline_characters_storyline_idx ON public.storyline_characters(storyline_id);

-- Avatar-Modelle: generierte oder hochgeladene Menschen/Modelle pro Brand
CREATE TABLE IF NOT EXISTS public.avatar_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'generated',  -- 'generated' | 'uploaded'
  prompt text,                             -- bei generated: der Erzeugungs-Prompt
  image_path text,                         -- Storage-Pfad des Referenzbilds
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avatar_models TO authenticated;
GRANT ALL ON public.avatar_models TO service_role;
ALTER TABLE public.avatar_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avatar_models owner all" ON public.avatar_models
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS avatar_models_brand_idx ON public.avatar_models(brand_id);

-- Generierungs-Jobs: eine Queue für alle KI-Erzeugungen
-- kind: 'video' (Storyline-Episode), 'scene' (Einzelszene),
--       'model' (Mensch/Avatar-Bild), 'overlap' (Face/Body-Swap auf eigenes Video)
CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE SET NULL,
  avatar_model_id uuid REFERENCES public.avatar_models(id) ON DELETE SET NULL,
  raw_video_id uuid REFERENCES public.raw_videos(id) ON DELETE SET NULL,
  kind text NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Dauer, Aspect, Sound an/aus, Stimme …
  status text NOT NULL DEFAULT 'pending',      -- pending | waiting_provider | running | done | failed
  progress integer NOT NULL DEFAULT 0,
  provider text,                               -- z.B. 'fal', 'replicate', 'heygen'
  provider_job_id text,
  output_path text,                            -- Storage-Pfad des Ergebnisses
  output_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_jobs TO authenticated;
GRANT ALL ON public.generation_jobs TO service_role;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "generation_jobs owner all" ON public.generation_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER generation_jobs_updated_at BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS generation_jobs_brand_idx ON public.generation_jobs(brand_id, status, created_at DESC);
