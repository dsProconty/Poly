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
        'world cup', 'copa america', 'nba champion', 'super bowl', 'stanley cup',
        'strike out the most', 'perfect game', 'win the league', 'win the pennant',
        'win the season', 'win the series', 'nba mvp', 'ballon',
      ];
      // Traer TODAS las posiciones abiertas con sus preguntas
      const { data: stuck, error: fetchErr } = await supabase
        .from('positions')
        .select('id, question, stake_usd, end_date, created_at')
        .eq('status', 'open');

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      const PROP_KEYWORDS = [
        'run scored in the first','score in the first','first inning',
        'be on the cover','play for','sign with','transfer to','be traded',
        'most strikeouts','most home runs','most points','most rebounds',
        'strike out the most','perfect game','be named','be selected',
      ];

      const toDelete = (stuck || []).filter(p => {
        const q = p.question.toLowerCase();
        // Keyword match: futures atascadas
        if (STUCK_KEYWORDS.some(k => q.includes(k))) return true;
        // Keyword match: props que se colaron
        if (PROP_KEYWORDS.some(k => q.includes(k))) return true;
        // Fallback: end_date ya pasó hace más de 14 días (bets viejas no resueltas)
        if (p.end_date && new Date(p.end_date) < new Date(Date.now() - 14 * 86400000)) return true;
        // Fallback: sin end_date y creada antes del fix (30 abr)
        if (!p.end_date && new Date(p.created_at) < new Date('2026-04-30T00:00:00Z')) return true;
        return false;
      });

      if (!toDelete.length) return res.json({ deleted_count: 0, all_open: (stuck||[]).map(p=>p.question) });

      const refund = toDelete.reduce((s, p) => s + parseFloat(p.stake_usd || 0), 0);
      const ids = toDelete.map(p => p.id);

      // Eliminar trades_log primero (por si acaso el cascade falla)
      await supabase.from('trades_log').delete().in('position_id', ids);
      // Eliminar posiciones
      const { error: delErr } = await supabase.from('positions').delete().in('id', ids);
      if (delErr) return res.status(500).json({ error: delErr.message, ids });

      // Devolver stake al bankroll
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
