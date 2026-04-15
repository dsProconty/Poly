import { createClient } from '@supabase/supabase-js';
import { runBot } from '../../lib/runBot.js';
import { resolvePositions } from '../../lib/resolvePositions.js';
import { isValidSession } from './auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Endpoint interno para el dashboard.
 * Llama la lógica directamente (sin HTTP interno) para evitar
 * problemas de routing en Vercel serverless.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isValidSession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;
  if (!action || !['run-bot', 'resolve'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser "run-bot" o "resolve"' });
  }

  try {
    const result = action === 'resolve'
      ? await resolvePositions(supabase)
      : await runBot(supabase);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
