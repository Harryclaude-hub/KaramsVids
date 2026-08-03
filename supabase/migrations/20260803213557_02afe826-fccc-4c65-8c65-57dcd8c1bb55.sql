ALTER TABLE public.brand_credentials
  ADD COLUMN IF NOT EXISTS setup_status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS setup_updated_at timestamptz;