-- ============================================================
-- Direktnachrichten (DMs) lesen und beantworten
--  1. Posteingang social_dms, ein Datensatz je eingehender Nachricht
--  2. Antwort-Regeln bekommen einen Kanal: comment | dm | both
--  3. Schalter und Sync-Zeitstempel je Account
--
-- Hinweis: Fuer DMs braucht die Meta-App die Rechte
-- instagram_manage_messages (Instagram) und pages_messaging (Facebook).
-- Bereits verbundene Kanaele muessen einmal neu verbunden werden.
-- ============================================================

-- ---------- 1. DM-Posteingang ----------
CREATE TABLE IF NOT EXISTS public.social_dms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,

  -- Konversation (Thread) und Nachricht bei der Plattform
  external_thread_id text NOT NULL,
  external_message_id text NOT NULL,
  -- Absender: bei Messenger die PSID, bei Instagram die IGSID.
  -- Genau diese ID braucht die Antwort als Empfaenger.
  sender_id text NOT NULL,
  sender_name text,
  text text NOT NULL DEFAULT '',
  received_at timestamptz,

  -- new | replied | skipped | failed
  status text NOT NULL DEFAULT 'new'
    CONSTRAINT social_dms_status_check CHECK (status IN ('new', 'replied', 'skipped', 'failed')),
  reply_text text,
  -- template | ai | manual
  reply_mode text,
  rule_id uuid,
  replied_at timestamptz,
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Jede Nachricht hoechstens einmal je Account, das ist die Bremse gegen Doppelantworten.
CREATE UNIQUE INDEX IF NOT EXISTS social_dms_unique
  ON public.social_dms (social_account_id, external_message_id);
-- Posteingang: nach Status gefiltert, neueste zuerst
CREATE INDEX IF NOT EXISTS social_dms_inbox_idx
  ON public.social_dms (user_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS social_dms_brand_idx
  ON public.social_dms (brand_id, received_at DESC);
-- Verlauf eines Threads
CREATE INDEX IF NOT EXISTS social_dms_thread_idx
  ON public.social_dms (social_account_id, external_thread_id, received_at DESC);
-- Letzte Nachricht eines Absenders (fuer das 24-Stunden-Fenster von Meta)
CREATE INDEX IF NOT EXISTS social_dms_sender_idx
  ON public.social_dms (social_account_id, sender_id, received_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_dms TO authenticated;
GRANT ALL ON public.social_dms TO service_role;
ALTER TABLE public.social_dms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_dms owner all" ON public.social_dms;
CREATE POLICY "social_dms owner all" ON public.social_dms
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS social_dms_set_updated_at ON public.social_dms;
CREATE TRIGGER social_dms_set_updated_at BEFORE UPDATE ON public.social_dms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Regeln bekommen einen Kanal ----------
-- comment = nur Kommentare (Standard, damit bestehende Regeln sich nicht aendern)
-- dm      = nur Direktnachrichten
-- both    = beides, das Tageslimit zaehlt dann ueber Kommentare und DMs zusammen
ALTER TABLE public.comment_reply_rules
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'comment';
ALTER TABLE public.comment_reply_rules
  DROP CONSTRAINT IF EXISTS comment_reply_rules_channel_check;
ALTER TABLE public.comment_reply_rules
  ADD CONSTRAINT comment_reply_rules_channel_check CHECK (channel IN ('comment', 'dm', 'both'));
CREATE INDEX IF NOT EXISTS comment_reply_rules_channel_idx
  ON public.comment_reply_rules (user_id, channel, active);

-- ---------- 3. Schalter je Account ----------
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS auto_reply_dms_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_dm_sync_at timestamptz;
