
-- 1) Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (status IN ('pending','approved','rejected'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('user','admin'));

-- 2) Admin check helper (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _uid AND role = 'admin'
  );
$$;

-- 3) Admin RLS policies
DROP POLICY IF EXISTS "profiles admin read all" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "profiles admin update all" ON public.profiles;
CREATE POLICY "profiles admin update all" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 4) Update handle_new_user to include email + pending status; auto-approve admin email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin_email boolean := NEW.email = 'saifokaram1@gmail.com';
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url, role, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN is_admin_email THEN 'admin' ELSE 'user' END,
    CASE WHEN is_admin_email THEN 'approved' ELSE 'pending' END,
    CASE WHEN is_admin_email THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- 5) Attach trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6) Backfill existing auth users into profiles + set email/status/role for existing profile rows
INSERT INTO public.profiles (id, email, display_name, role, status, approved_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email,'@',1)),
  CASE WHEN u.email = 'saifokaram1@gmail.com' THEN 'admin' ELSE 'user' END,
  CASE WHEN u.email = 'saifokaram1@gmail.com' THEN 'approved' ELSE 'pending' END,
  CASE WHEN u.email = 'saifokaram1@gmail.com' THEN now() ELSE NULL END
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- Ensure admin email is admin+approved even if profile pre-existed
UPDATE public.profiles p
SET role = 'admin', status = 'approved', approved_at = COALESCE(p.approved_at, now())
FROM auth.users u
WHERE p.id = u.id AND u.email = 'saifokaram1@gmail.com';
