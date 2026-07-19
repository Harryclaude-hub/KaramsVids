
CREATE POLICY "raw_videos owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'raw-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "raw_videos owner write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'raw-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "raw_videos owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'raw-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "raw_videos owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'raw-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "rendered_clips owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rendered-clips' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "rendered_clips owner write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rendered-clips' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "rendered_clips owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'rendered-clips' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "rendered_clips owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rendered-clips' AND (storage.foldername(name))[1] = auth.uid()::text);
