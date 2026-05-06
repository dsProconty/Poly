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
  if (!action || !['run-bot', 'resolve', 'close-futures'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser "run-bot", "resolve" o "close-futures"' });
  }

  try {
    if (action === 'close-futures') {
      const FUTURES_KEYWORDS = ['2026 fifa world cup', 'win the world cup', 'copa america', 'win the league', 'nba champion', 'super bowl', 'stanley cup'];
      const { data: stuck } = await supabase
        .from('positions')
        .select('id, question, stake_usd')
        .eq('status', 'open');

      const toClose = (stuck || []).filter(p =>
        FUTURES_KEYWORDS.some(k => p.question.toLowerCase().includes(k))
      );

      const closed = [];
      for (const pos of toClose) {
        await supabase.from('positions').update({
          status: 'closed',
          outcome: 'loss',
          pnl: -parseFloat(pos.stake_usd),
          closed_at: new Date().toISOString(),
        }).eq('id', pos.id);
        closed.push(pos.question);
      }
      return res.json({ closed_count: closed.length, closed });
    }

    const result = action === 'resolve'
      ? await resolvePositions(supabase)
      : await runBot(supabase);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
