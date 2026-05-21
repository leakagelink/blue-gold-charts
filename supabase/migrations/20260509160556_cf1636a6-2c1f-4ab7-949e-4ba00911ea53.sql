
DO $$
DECLARE v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email='hello@tradego.com';
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, email, client_id, is_approved, approved_at)
    VALUES (v_user_id, 'Broker Admin', 'hello@tradego.com', generate_client_id(), true, now())
    ON CONFLICT (id) DO UPDATE SET is_approved = true, approved_at = now();

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;
