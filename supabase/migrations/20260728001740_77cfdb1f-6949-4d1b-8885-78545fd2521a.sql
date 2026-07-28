
-- ============ WORKSPACES (Profile) ============
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#F26A1F',
  avatar_path text,
  payout_provider text,
  payout_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspaces owner all" ON public.workspaces FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ AFFILIATE PROGRAMS ============
CREATE TABLE public.affiliate_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  link text NOT NULL,
  payout_type text NOT NULL DEFAULT 'cpm',
  payout_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliate_programs TO authenticated;
GRANT ALL ON public.affiliate_programs TO service_role;
ALTER TABLE public.affiliate_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliate_programs owner all" ON public.affiliate_programs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER affiliate_programs_set_updated_at BEFORE UPDATE ON public.affiliate_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ EARNINGS ============
CREATE TABLE public.earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  affiliate_program_id uuid REFERENCES public.affiliate_programs(id) ON DELETE SET NULL,
  platform text,
  source text NOT NULL DEFAULT 'platform',
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  views bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  period_start date,
  period_end date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.earnings TO authenticated;
GRANT ALL ON public.earnings TO service_role;
ALTER TABLE public.earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "earnings owner all" ON public.earnings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER earnings_set_updated_at BEFORE UPDATE ON public.earnings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ BRANDS -> WORKSPACE ============
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- Bestehende Brands in ein Standard-Profil pro User migrieren
INSERT INTO public.workspaces (user_id, name)
SELECT DISTINCT b.user_id, 'Mein Profil' FROM public.brands b
WHERE b.workspace_id IS NULL;

UPDATE public.brands b
SET workspace_id = w.id
FROM public.workspaces w
WHERE b.workspace_id IS NULL AND w.user_id = b.user_id AND w.name = 'Mein Profil';

CREATE INDEX IF NOT EXISTS brands_workspace_idx ON public.brands(workspace_id);

-- ============ CLIPS: Affiliate-Verknüpfung ============
ALTER TABLE public.generated_clips
  ADD COLUMN IF NOT EXISTS affiliate_program_id uuid REFERENCES public.affiliate_programs(id) ON DELETE SET NULL;

-- ============ SCHEDULES: Multi-Brand + Shuffle ============
ALTER TABLE public.publish_schedules
  ADD COLUMN IF NOT EXISTS brand_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS shuffle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.publish_schedules s
SET workspace_id = b.workspace_id
FROM public.brands b
WHERE s.workspace_id IS NULL AND b.id = s.brand_id;
