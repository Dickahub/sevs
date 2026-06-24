REVOKE EXECUTE ON FUNCTION public.cast_ballot_tx(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cast_ballot_tx(uuid, uuid, text, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cast_ballot_tx(uuid, uuid, text, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cast_ballot_tx(uuid, uuid, text, text, text, text, text, text, text) TO service_role;