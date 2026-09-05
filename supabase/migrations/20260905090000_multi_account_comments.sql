-- ============================================================
-- Ausbau zur Multi-Account-Plattform
--  1. Beliebig viele Accounts pro Plattform und Brand
--  2. Kommentar-Posteingang ueber alle Plattformen
--  3. Auto-Antwort-Regeln (Vorlage oder KI)
--  4. Kennzahlen pro Beitrag fuer echtes Tracking
-- ============================================================

-- ---------- 1. Mehrere Accounts pro Plattform ----------
-- Der alte Constraint erlaubte genau einen Account je Plattform und Nutzer.
ALTER TABLE public.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_user_id_platform_key;

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_comment_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS follower_count bigint NOT NULL DEFAULT 0;

-- Derselbe Kanal darf nur einmal pro Brand haengen, verschiedene Kanaele
-- derselben Plattform sind ausdruecklich erlaubt.
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_unique_channel
  ON public.social_accounts (
    user_id,
    platform,
    coalesce(brand_id::text, ''),
    coalesce(external_id, '')
  );

CREATE INDEX IF NOT EXISTS social_accounts_user_platform_idx
  ON public.social_accounts (user_id, platform);

-- ---------- 2. Kommentar-Posteingang ----------
CREATE TABLE IF NOT EXISTS public.social_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,

  external_comment_id text NOT NULL,
  external_post_id text,
  post_url text,

  author_handle text,
  author_name text,
  text text NOT NULL DEFAULT '',
  like_count integer NOT NULL DEFAULT 0,
  posted_at timestamptz,

  -- new | replied | skipped | failed | hidden
  status text NOT NULL DEFAULT 'new',
  sentiment text,
  reply_text text,
  reply_mode text,
  rule_id uuid,
  replied_at timestamptz,
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_comments_unique
  ON public.social_comments (social_account_id, external_comment_id);
CREATE INDEX IF NOT EXISTS social_comments_inbox_idx
  ON public.social_comments (user_id, status, posted_at DESC);
CREATE INDEX IF NOT EXISTS social_comments_brand_idx
  ON public.social_comments (brand_id, posted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_comments TO authenticated;
GRANT ALL ON public.social_comments TO service_role;
ALTER TABLE public.social_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_comments owner all" ON public.social_comments;
CREATE POLICY "social_comments owner all" ON public.social_comments
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS social_comments_set_updated_at ON public.social_comments;
CREATE TRIGGER social_comments_set_updated_at BEFORE UPDATE ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. Auto-Antwort-Regeln ----------
CREATE TABLE IF NOT EXISTS public.comment_reply_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  -- NULL = gilt fuer alle Plattformen des Brands
  platform text,
  -- NULL = gilt fuer alle Accounts
  social_account_id uuid REFERENCES public.social_accounts(id) ON DELETE CASCADE,

  name text NOT NULL DEFAULT 'Regel',
  -- template | ai
  mode text NOT NULL DEFAULT 'template',
  -- Stichwoerter, leer = jeder Kommentar passt
  keywords text[] NOT NULL DEFAULT '{}',
  -- Kommentare mit diesen Woertern werden uebersprungen
  exclude_keywords text[] NOT NULL DEFAULT '{}',
  -- Vorlage mit {name} {brand} {kommentar}
  message_template text,
  -- Anweisung an die KI, wenn mode = 'ai'
  ai_instruction text,
  ai_tone text NOT NULL DEFAULT 'freundlich',
  max_length integer NOT NULL DEFAULT 220,
  -- Sicherheitsnetz gegen Spam und Endlosschleifen
  daily_limit integer NOT NULL DEFAULT 50,
  delay_minutes integer NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comment_reply_rules_lookup_idx
  ON public.comment_reply_rules (user_id, active, priority DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comment_reply_rules TO authenticated;
GRANT ALL ON public.comment_reply_rules TO service_role;
ALTER TABLE public.comment_reply_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "comment_reply_rules owner all" ON public.comment_reply_rules;
CREATE POLICY "comment_reply_rules owner all" ON public.comment_reply_rules
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS comment_reply_rules_set_updated_at ON public.comment_reply_rules;
CREATE TRIGGER comment_reply_rules_set_updated_at BEFORE UPDATE ON public.comment_reply_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 4. Kennzahlen je Beitrag ----------
CREATE TABLE IF NOT EXISTS public.post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,

  external_post_id text NOT NULL,
  post_url text,
  title text,
  published_at timestamptz,

  views bigint NOT NULL DEFAULT 0,
  likes bigint NOT NULL DEFAULT 0,
  comments bigint NOT NULL DEFAULT 0,
  shares bigint NOT NULL DEFAULT 0,
  saves bigint NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,

  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_unique
  ON public.post_metrics (social_account_id, external_post_id);
CREATE INDEX IF NOT EXISTS post_metrics_brand_idx
  ON public.post_metrics (brand_id, published_at DESC);
CREATE INDEX IF NOT EXISTS post_metrics_user_idx
  ON public.post_metrics (user_id, views DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_metrics TO authenticated;
GRANT ALL ON public.post_metrics TO service_role;
ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_metrics owner all" ON public.post_metrics;
CREATE POLICY "post_metrics owner all" ON public.post_metrics
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS post_metrics_set_updated_at ON public.post_metrics;
CREATE TRIGGER post_metrics_set_updated_at BEFORE UPDATE ON public.post_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 5. Echte statt erfundener Zahlen ----------
-- Kennzeichnet, ob ein Snapshot von der Plattform kam oder simuliert wurde.
ALTER TABLE public.analytics_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live';

-- Einnahmen brauchen einen Bezug zum Kanal, damit Umsatz je Account
-- ausgewertet werden kann.
ALTER TABLE public.earnings
  ADD COLUMN IF NOT EXISTS social_account_id uuid REFERENCES public.social_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS earnings_account_idx ON public.earnings (social_account_id);
