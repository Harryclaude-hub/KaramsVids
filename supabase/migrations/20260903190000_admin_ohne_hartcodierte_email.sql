-- ============================================================
-- Admin-Kennung von der hartcodierten E-Mail-Adresse loesen.
--
-- Bisher stand in handle_new_user() eine feste E-Mail-Adresse im
-- Funktionskoerper. Zwei Probleme:
--   1. Schwache Kennung. Wer diese Adresse uebernimmt, uebernimmt die
--      Plattform. Die Rolle steht ohnehin schon in profiles.role und
--      wird von is_admin() und is_approved() so geprueft.
--   2. Eine private Adresse liegt im Klartext im Funktionskoerper und
--      damit in jedem Schema-Dump.
--
-- Diese Migration schreibt die Funktion neu: kein Adressvergleich mehr,
-- neue Nutzer bekommen immer role='user' und status='pending'. Der
-- bestehende Admin behaelt seine Rolle, weil seine profiles-Zeile bereits
-- angelegt ist und hier nicht angefasst wird.
--
-- Weitere Admins werden ab jetzt vergeben, indem die Rolle direkt gesetzt
-- wird (oder ueber das Admin-Portal):
--   UPDATE public.profiles SET role = 'admin', status = 'approved',
--          approved_at = now()
--   WHERE id = '<auth.users.id>';
--
-- Fruehere Migrationen bleiben unangetastet: sie sind bereits gelaufen,
-- und ihr Umschreiben wuerde die Historie verfaelschen, ohne an der
-- laufenden Datenbank etwas zu aendern.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url, role, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    'user',
    'pending',
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Sicherheitsnetz: sollte durch das Entfernen der Sonderbehandlung kein
-- Administrator mehr existieren, wird der aelteste freigegebene Nutzer
-- zum Administrator befoerdert. Ohne diesen Schritt koennte sich niemand
-- mehr im Admin-Portal anmelden.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    UPDATE public.profiles
       SET role = 'admin',
           status = 'approved',
           approved_at = COALESCE(approved_at, now())
     WHERE id = (
       SELECT id FROM public.profiles
        WHERE status = 'approved'
        ORDER BY created_at
        LIMIT 1
     );
  END IF;
END $$;
