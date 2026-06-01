-- 1) position_audit_log: tighten INSERT
DROP POLICY IF EXISTS "System can insert audit log" ON public.position_audit_log;
CREATE POLICY "Users can insert own audit entries"
  ON public.position_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (changed_by = auth.uid() AND user_id = auth.uid())
  );

-- 2) user_roles: split policies so only admins can insert/update/delete; preserve admin SELECT
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles"
  ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update roles"
  ON public.user_roles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete roles"
  ON public.user_roles
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) user_wallets: restrict insert to authenticated
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.user_wallets;
CREATE POLICY "Users can insert own wallet"
  ON public.user_wallets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 4) payment-proofs bucket: make private and restrict reads
UPDATE storage.buckets SET public = false WHERE id = 'payment-proofs';
DROP POLICY IF EXISTS "Anyone can view payment proofs" ON storage.objects;
CREATE POLICY "Users can view own payment proofs"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR (auth.uid())::text = (storage.foldername(name))[1]
    )
  );