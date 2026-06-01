-- Table to track app releases
CREATE TABLE public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  file_url text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  release_notes text,
  is_active boolean NOT NULL DEFAULT true,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_releases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_releases TO authenticated;
GRANT ALL ON public.app_releases TO service_role;

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active releases"
  ON public.app_releases FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can view all releases"
  ON public.app_releases FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert releases"
  ON public.app_releases FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update releases"
  ON public.app_releases FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete releases"
  ON public.app_releases FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_app_releases_updated_at
  BEFORE UPDATE ON public.app_releases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Public storage bucket for APK files
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-releases', 'app-releases', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Public can read app releases"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'app-releases');

CREATE POLICY "Admins can upload app releases"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'app-releases' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update app releases"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'app-releases' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete app releases"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'app-releases' AND has_role(auth.uid(), 'admin'::app_role));