
-- Extend generated_clips
ALTER TABLE public.generated_clips
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS queue_position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_url text,
  ADD COLUMN IF NOT EXISTS publish_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS generated_clips_brand_platform_status_idx
  ON public.generated_clips (brand_id, platform, status, queue_position);

-- Ensure RLS + basic policy on generated_clips
ALTER TABLE public.generated_clips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='generated_clips' AND policyname='clips owner all') THEN
    CREATE POLICY "clips owner all" ON public.generated_clips
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_clips TO authenticated;
GRANT ALL ON public.generated_clips TO service_role;

DROP TRIGGER IF EXISTS generated_clips_updated_at ON public.generated_clips;
CREATE TRIGGER generated_clips_updated_at
  BEFORE UPDATE ON public.generated_clips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- publish_schedules
CREATE TABLE IF NOT EXISTS public.publish_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform text NOT NULL,
  cadence text NOT NULL DEFAULT 'daily', -- 'daily' | 'weekly'
  weekdays smallint[] NOT NULL DEFAULT '{}', -- 0=Sun ... 6=Sat, used when cadence='weekly'
  time_of_day time NOT NULL DEFAULT '18:00',
  videos_per_slot integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_schedules TO authenticated;
GRANT ALL ON public.publish_schedules TO service_role;

ALTER TABLE public.publish_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedules owner all" ON public.publish_schedules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER publish_schedules_updated_at
  BEFORE UPDATE ON public.publish_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS publish_schedules_next_run_idx
  ON public.publish_schedules (active, next_run_at);
