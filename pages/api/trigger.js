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
      const STUCK_KEYWORDS = [
        '2026 fifa world cup', 'win the world cup', 'win the 2026',
        'copa america', 'nba champion', 'super bowl', 'stanley cup',
        'strike out the most', 'perfect game',
      ];
      const { data: stuck } = await supabase
        .from('positions')
        .select('id, question, stake_usd')
        .eq('status', 'open');

      const toDelete = (stuck || []).filter(p =>
        STUCK_KEYWORDS.some(k => p.question.toLowerCase().includes(k))
      );

      if (!toDelete.length) return res.json({ deleted_count: 0, deleted: [] });

      // Sumar stakes a devolver al bankroll
      const refund = toDelete.reduce((s, p) => s + parseFloat(p.stake_usd || 0), 0);
      const ids = toDelete.map(p => p.id);

      // Eliminar posiciones
      await supabase.from('positions').delete().in('id', ids);

      // Devolver el stake al bankroll
      const { data: br } = await supabase.from('bankroll_state').select('*').single();
      const newCash = parseFloat((parseFloat(br.available_cash) + refund).toFixed(2));
      await supabase.from('bankroll_state').update({
        available_cash: newCash,
        updated_at: new Date().toISOString(),
      }).eq('id', br.id);

      return res.json({ deleted_count: toDelete.length, refund_usd: refund, deleted: toDelete.map(p => p.question) });
    }

    const result = action === 'resolve'
      ? await resolvePositions(supabase)
      : await runBot(supabase);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
