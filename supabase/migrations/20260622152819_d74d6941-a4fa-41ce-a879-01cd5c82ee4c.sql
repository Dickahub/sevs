UPDATE public.elections
SET opens_at = now() - interval '2 days',
    closes_at = now() + interval '45 days'
WHERE status = 'open';