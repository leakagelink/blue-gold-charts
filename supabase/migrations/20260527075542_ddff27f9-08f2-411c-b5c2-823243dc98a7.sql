CREATE OR REPLACE FUNCTION public.generate_client_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  new_id TEXT;
  id_exists BOOLEAN;
BEGIN
  LOOP
    new_id := 'GFT' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE client_id = new_id) INTO id_exists;
    IF NOT id_exists THEN
      RETURN new_id;
    END IF;
  END LOOP;
END;
$function$;