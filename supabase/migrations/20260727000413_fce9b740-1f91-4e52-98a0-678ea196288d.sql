-- 1) Clips: Beitragstyp + Caption
ALTER TABLE public.generated_clips
  ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'reel',
  ADD COLUMN IF NOT EXISTS post_caption text,
  ADD COLUMN IF NOT EXISTS hashtags text;

-- 2) Zeitpläne: mehrere Plattformen, Beitragstypen, Intervall
ALTER TABLE public.publish_schedules
  ADD COLUMN IF NOT EXISTS platforms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS post_types text[] NOT NULL DEFAULT '{reel}',
  ADD COLUMN IF NOT EXISTS interval_minutes integer;

UPDATE public.publish_schedules
SET platforms = ARRAY[platform]
WHERE cardinality(platforms) = 0;

-- 3) Brands: Wunsch-Handle + Bio
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS handle text,
  ADD COLUMN IF NOT EXISTS bio text;

-- 4) Brand-Zugänge (Passwort verschlüsselt in der App)
CREATE TABLE public.brand_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform text NOT NULL,
  username text,
  email text,
  password_encrypted text,
  login_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, platform)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_credentials TO authenticated;
GRANT ALL ON public.brand_credentials TO service_role;
ALTER TABLE public.brand_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own brand credentials" ON public.brand_credentials
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER brand_credentials_updated_at BEFORE UPDATE ON public.brand_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Automatische Antworten
CREATE TABLE public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'follow',
  keyword text,
  message_template text NOT NULL,
  delay_minutes integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own automation rules" ON public.automation_rules
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER automation_rules_updated_at BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6) Protokoll
CREATE TABLE public.automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  platform text NOT NULL,
  trigger_type text NOT NULL,
  target_handle text,
  message_sent text,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.automation_events TO authenticated;
GRANT ALL ON public.automation_events TO service_role;
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own automation events" ON public.automation_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX idx_automation_events_brand ON public.automation_events(brand_id, created_at DESC);