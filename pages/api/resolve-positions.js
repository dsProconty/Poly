import { createClient } from '@supabase/supabase-js';
import { resolvePositions } from '../../lib/resolvePositions.js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const result = await resolvePositions(supabase);
    return res.json(result);
  } catch (err) {
    console.error('[resolve-positions] Error crítico:', err);
    return res.status(500).json({ status: 'error', error: err.message });
  }
}
