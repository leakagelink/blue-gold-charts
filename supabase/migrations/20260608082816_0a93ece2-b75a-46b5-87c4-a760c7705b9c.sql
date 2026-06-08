
-- 1. Profiles: restrict user UPDATE to safe columns only via trigger guard
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow Brokers to change any field
  IF has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Block users from changing broker-controlled fields
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.max_leverage IS DISTINCT FROM OLD.max_leverage
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Cannot modify broker-controlled fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_privilege_escalation_trg ON public.profiles;
CREATE TRIGGER prevent_profile_privilege_escalation_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- 2 & 3. user_wallets: remove user INSERT and UPDATE policies. Mutations only via SECURITY DEFINER functions.
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Users can update own wallet" ON public.user_wallets;

-- 4. payment-proofs storage: allow users to delete their own files
DROP POLICY IF EXISTS "Users can delete own payment proofs" ON storage.objects;
CREATE POLICY "Users can delete own payment proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. position_audit_log: ensure the referenced position belongs to the user
DROP POLICY IF EXISTS "Users can insert own audit entries" ON public.position_audit_log;

CREATE POLICY "Users can insert own audit entries"
ON public.position_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  changed_by = auth.uid()
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.positions p
    WHERE p.id = position_audit_log.position_id
      AND p.user_id = auth.uid()
  )
);
