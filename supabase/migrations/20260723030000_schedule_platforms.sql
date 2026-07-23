-- Upload-Pläne: mehrere Plattformen pro Plan (oder alle)
ALTER TABLE public.publish_schedules
  ADD COLUMN IF NOT EXISTS platforms text[] NOT NULL DEFAULT '{}';

-- Bestehende Pläne: einzelne Plattform in das Array übernehmen
UPDATE public.publish_schedules
SET platforms = ARRAY[platform]
WHERE platforms = '{}' AND platform IS NOT NULL;
