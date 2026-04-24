/**
 * GET /api/stats — estadísticas completas de todas las posiciones
 * No requiere auth para facilitar consulta rápida desde el dashboard.
 * Protegido igual que status.js si DASHBOARD_PASSWORD está configurado.
 */
import { createClient } from '@supabase/supabase-js';
import { isValidSession } from './auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Si hay password configurado, requerir sesión
  if (process.env.DASHBOARD_PASSWORD && !isValidSession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [bankrollRes, allPositionsRes] = await Promise.all([
      supabase.from('bankroll_state').select('*').single(),
      supabase
        .from('positions')
        .select('id, question, rec_side, rec_team, stake_usd, market_prob, rec_prob, status, outcome, pnl, created_at, closed_at')
        .order('created_at', { ascending: false }),
    ]);

    if (bankrollRes.error) throw new Error(bankrollRes.error.message);
    if (allPositionsRes.error) throw new Error(allPositionsRes.error.message);

    const all       = allPositionsRes.data || [];
    const open      = all.filter(p => p.status === 'open');
    const closed    = all.filter(p => p.status === 'closed');
    const wins      = closed.filter(p => p.outcome === 'win');
    const losses    = closed.filter(p => p.outcome === 'loss');

    const totalStaked   = all.reduce((s, p) => s + parseFloat(p.stake_usd || 0), 0);
    const openExposure  = open.reduce((s, p) => s + parseFloat(p.stake_usd || 0), 0);
    const totalPnl      = closed.reduce((s, p) => s + parseFloat(p.pnl || 0), 0);
    const winRate       = closed.length ? ((wins.length / closed.length) * 100).toFixed(1) : null;
    const avgStake      = all.length ? (totalStaked / all.length).toFixed(2) : 0;

    // Distribución de qué apuesta (YES/NO) y razón (draw vs win)
    const sideCount = all.reduce((acc, p) => {
      acc[p.rec_side] = (acc[p.rec_side] || 0) + 1;
      return acc;
    }, {});

    // Últimas 5 cerradas
    const recentClosed = closed.slice(0, 5).map(p => ({
      question: p.question?.slice(0, 60) + '...',
      side: p.rec_side,
      stake: p.stake_usd,
      outcome: p.outcome,
      pnl: p.pnl,
      closed_at: p.closed_at,
    }));

    return res.json({
      bankroll: {
        initial:   bankrollRes.data.initial_bankroll,
        available: bankrollRes.data.available_cash,
        roi:       bankrollRes.data.initial_bankroll
          ? (((bankrollRes.data.available_cash + openExposure - bankrollRes.data.initial_bankroll) / bankrollRes.data.initial_bankroll) * 100).toFixed(1) + '%'
          : null,
      },
      apuestas: {
        total:        all.length,
        abiertas:     open.length,
        cerradas:     closed.length,
        ganadas:      wins.length,
        perdidas:     losses.length,
        win_rate:     winRate ? winRate + '%' : 'N/A (sin cierres aún)',
        pendientes:   open.length,
      },
      dinero: {
        total_apostado:  parseFloat(totalStaked.toFixed(2)),
        en_juego:        parseFloat(openExposure.toFixed(2)),
        pnl_realizado:   parseFloat(totalPnl.toFixed(2)),
        stake_promedio:  parseFloat(avgStake),
      },
      distribucion_lado: sideCount,
      ultimas_cerradas:  recentClosed,
      todas_abiertas: open.map(p => ({
        question: p.question?.slice(0, 70),
        side: p.rec_side,
        stake: p.stake_usd,
        market_prob: p.market_prob,
        created_at: p.created_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
