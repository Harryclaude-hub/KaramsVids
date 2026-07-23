-- Brand-Profilbild + Intervall-Zeitpläne

-- Brands bekommen ein Profilbild (Storage-Pfad im raw-videos-Bucket)
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS avatar_path text;

-- Upload-Zeitpläne: neben daily/weekly jetzt auch 'interval'
-- (alle X Minuten/Stunden/Tage — gespeichert in Minuten)
ALTER TABLE public.publish_schedules ADD COLUMN IF NOT EXISTS interval_minutes integer;
