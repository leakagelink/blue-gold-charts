REVOKE EXECUTE ON FUNCTION public.drift_edited_positions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.drift_edited_positions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.drift_edited_positions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.drift_edited_positions() TO service_role;
GRANT EXECUTE ON FUNCTION public.drift_edited_positions() TO postgres;