/**
 * GET /api/check-results
 * Evalúa el resultado real de cada posición abierta usando el CLOB API.
 * Lógica:
 *   - token YES price > 0.95 → mercado resolvió YES
 *   - token YES price < 0.05 → mercado resolvió NO
 *   - Entre 0.05–0.95      → todavía en juego (pending)
 */
import { createClient } from '@supabase/supabase-js';

const CLOB = 'https://clob.polymarket.com';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchMarketPrice(conditionId) {
  try {
    const res = await fetch(`${CLOB}/markets/${conditionId}`);
    if (!res.ok) return null;
    const m = await res.json();

    // Precio YES desde tokens
    let yesPrice = null;
    if (Array.isArray(m.tokens)) {
      const t = m.tokens.find(t => t.outcome?.toLowerCase() === 'yes');
      if (t?.price != null) yesPrice = parseFloat(t.price);
    }

    return {
      yesPrice,
      resolved: m.resolved || false,
      outcome:  m.outcome  || null,
    };
  } catch {
    return null;
  }
}

function inferOutcome(yesPrice, resolved, officialOutcome) {
  if (resolved && officialOutcome) return { result: officialOutcome.toUpperCase(), confidence: 'official' };
  if (yesPrice === null)  return { result: 'unknown',  confidence: 'no_data' };
  if (yesPrice > 0.95)   return { result: 'YES',      confidence: 'high' };
  if (yesPrice < 0.05)   return { result: 'NO',       confidence: 'high' };
  if (yesPrice > 0.80)   return { result: 'YES',      confidence: 'medium' };
  if (yesPrice < 0.20)   return { result: 'NO',       confidence: 'medium' };
  return { result: 'pending', confidence: 'in_play' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: positions, error } = await supabase
      .from('positions')
      .select('id, market_id, question, rec_side, stake_usd, market_prob, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    if (!positions?.length) return res.json({ message: 'No hay posiciones abiertas', results: [] });

    // Consultar CLOB en lotes de 8 para no saturar
    const BATCH = 8;
    const results = [];

    for (let i = 0; i < positions.length; i += BATCH) {
      const batch = positions.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (pos) => {
          const market = await fetchMarketPrice(pos.market_id);
          const { result, confidence } = inferOutcome(
            market?.yesPrice ?? null,
            market?.resolved ?? false,
            market?.outcome  ?? null,
          );

          const botWon =
            result === 'pending' || result === 'unknown'
              ? null
              : pos.rec_side?.toUpperCase() === result;

          let estimatedPnl = null;
          if (botWon === true) {
            const p = parseFloat(pos.market_prob) / 100;
            const entry = pos.rec_side?.toUpperCase() === 'YES'
              ? (p > 0 ? p : 0.5) : (p < 1 ? 1 - p : 0.5);
            estimatedPnl = +((1 / entry - 1) * pos.stake_usd).toFixed(2);
          } else if (botWon === false) {
            estimatedPnl = -parseFloat(pos.stake_usd);
          }

          return {
            question:      pos.question,
            bot_bet:       pos.rec_side,
            stake:         pos.stake_usd,
            market_prob:   pos.market_prob + '%',
            yes_price_now: market?.yesPrice != null
              ? (market.yesPrice * 100).toFixed(1) + '%' : 'N/A',
            market_result: result,
            confidence,
            bot_acerto:    botWon === null ? '⏳ pendiente'
              : botWon ? '✅ SÍ' : '❌ NO',
            pnl_estimado:  estimatedPnl !== null
              ? (estimatedPnl >= 0 ? '+$' : '') + estimatedPnl.toFixed(2) : null,
            created_at: pos.created_at,
          };
        })
      );
      results.push(...batchResults);
    }

    const resolved = results.filter(r => r.market_result !== 'pending' && r.market_result !== 'unknown');
    const wins     = resolved.filter(r => r.bot_acerto === '✅ SÍ');
    const losses   = resolved.filter(r => r.bot_acerto === '❌ NO');
    const pending  = results.filter(r => r.market_result === 'pending' || r.market_result === 'unknown');
    const totalPnl = resolved.reduce((s, r) => s + (r.pnl_estimado ? parseFloat(String(r.pnl_estimado).replace(/[^0-9.\-]/g, '')) : 0), 0);

    return res.json({
      resumen: {
        total_evaluadas: results.length,
        resueltas:       resolved.length,
        ganadas:         wins.length,
        perdidas:        losses.length,
        pendientes:      pending.length,
        win_rate:        resolved.length
          ? (wins.length / resolved.length * 100).toFixed(1) + '%' : 'N/A',
        pnl_estimado:    (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2),
      },
      ganadas:   wins,
      perdidas:  losses,
      pendientes: pending.map(r => ({
        question:      r.question,
        bot_bet:       r.bot_bet,
        yes_price_now: r.yes_price_now,
        created_at:    r.created_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
