-- ============================================================
-- Admin-Portal: Registrierungs-Freigabe + Nutzerverwaltung
-- Admin: saifokaram1@gmail.com
-- Neue Registrierungen sind 'pending', bis der Admin freigibt.
-- ============================================================

-- Profile erweitern
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- E-Mails bestehender Nutzer nachtragen
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS NULL;

-- Admin-Konto setzen & freigeben (auch falls Profil noch fehlt)
INSERT INTO public.profiles (id, email, display_name, role, status, approved_at)
SELECT u.id, u.email, split_part(u.email, '@', 1), 'admin', 'approved', now()
FROM auth.users u
WHERE u.email = 'saifokaram1@gmail.com'
ON CONFLICT (id) DO UPDATE
  SET role = 'admin', status = 'approved', approved_at = COALESCE(public.profiles.approved_at, now()), email = EXCLUDED.email;

-- Registrierungs-Trigger: neue Nutzer starten als 'pending';
-- der Admin-Account wird automatisch freigegeben.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, email, role, status, approved_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email,
    CASE WHEN NEW.email = 'saifokaram1@gmail.com' THEN 'admin' ELSE 'user' END,
    CASE WHEN NEW.email = 'saifokaram1@gmail.com' THEN 'approved' ELSE 'pending' END,
    CASE WHEN NEW.email = 'saifokaram1@gmail.com' THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helfer (SECURITY DEFINER verhindert RLS-Rekursion auf profiles)
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_approved() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (status = 'approved' OR role = 'admin'));
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin(), public.is_approved() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_approved() TO authenticated;

-- Admin darf alle Profile sehen und ändern (Freigeben/Ablehnen)
DROP POLICY IF EXISTS "profiles admin read all" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "profiles admin update all" ON public.profiles;
CREATE POLICY "profiles admin update all" ON public.profiles FOR UPDATE USING (public.is_admin());

-- ============================================================
-- HARTE SPERRE: Nicht freigegebene Nutzer kommen an keine Daten.
-- RESTRICTIVE-Policies gelten ZUSÄTZLICH zu den Owner-Policies.
-- (profiles selbst bleibt lesbar, damit die App den Status anzeigen kann)
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brands', 'folders', 'raw_videos', 'edit_jobs', 'generated_clips',
    'social_accounts', 'analytics_snapshots', 'publish_schedules',
    'storylines', 'storyline_characters', 'avatar_models', 'generation_jobs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "nur freigegebene Nutzer" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "nur freigegebene Nutzer" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_approved()) WITH CHECK (public.is_approved())',
      t
    );
  END LOOP;
END $$;
