/**
 * GET /api/check-results
 * Evalúa el resultado real de cada posición abierta consultando el precio
 * actual del mercado en Gamma API. No espera a resolved=true del CLOB.
 *
 * Lógica:
 *   - YES price > 0.95 → mercado resolvió YES
 *   - YES price < 0.05 → mercado resolvió NO
 *   - Entre 0.05 y 0.95 → todavía en juego (pending)
 *
 * Si el bot apostó YES y resolvió YES → WIN
 * Si el bot apostó YES y resolvió NO  → LOSS
 * (y viceversa para apuestas NO)
 */
import { createClient } from '@supabase/supabase-js';

const GAMMA = 'https://gamma-api.polymarket.com';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseYesPrice(market) {
  // outcomePrices puede ser string JSON o array
  let outcomes = market.outcomes;
  let prices   = market.outcomePrices;
  if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; } }
  if (typeof prices   === 'string') { try { prices   = JSON.parse(prices);   } catch { prices   = []; } }
  if (Array.isArray(outcomes) && Array.isArray(prices)) {
    const idx = outcomes.findIndex(o =>
      (typeof o === 'string' ? o : o?.name || '').toLowerCase() === 'yes'
    );
    if (idx >= 0) return parseFloat(prices[idx]);
  }
  // Fallback: tokens
  if (Array.isArray(market.tokens)) {
    const t = market.tokens.find(t => t.outcome?.toLowerCase() === 'yes');
    if (t?.price) return parseFloat(t.price);
  }
  return null;
}

async function fetchMarketPrice(conditionId) {
  try {
    // Gamma API requiere ?condition_ids= no /{id}
    const res = await fetch(`${GAMMA}/markets?condition_ids=${conditionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const market = Array.isArray(data) ? data[0] : data;
    if (!market) return null;
    return {
      yesPrice: parseYesPrice(market),
      resolved: market.resolved || false,
      outcome:  market.outcome  || null,
      question: market.question,
    };
  } catch {
    return null;
  }
}

function inferOutcome(yesPrice, resolved, officialOutcome) {
  // Si ya está oficialmente resuelto, usar eso
  if (resolved && officialOutcome) {
    return { result: officialOutcome.toUpperCase(), confidence: 'official' };
  }
  if (yesPrice === null) return { result: 'unknown', confidence: 'no_data' };
  if (yesPrice > 0.95)   return { result: 'YES',     confidence: 'high' };
  if (yesPrice < 0.05)   return { result: 'NO',      confidence: 'high' };
  if (yesPrice > 0.80)   return { result: 'YES',     confidence: 'medium' };
  if (yesPrice < 0.20)   return { result: 'NO',      confidence: 'medium' };
  return { result: 'pending', confidence: 'in_play' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: positions, error } = await supabase
      .from('positions')
      .select('id, market_id, question, rec_side, stake_usd, market_prob, rec_prob, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    if (!positions?.length) return res.json({ message: 'No hay posiciones abiertas', results: [] });

    // Consultar Gamma API en paralelo (lotes de 10 para no saturar)
    const BATCH = 10;
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

          // PnL estimado
          let estimatedPnl = null;
          if (botWon === true) {
            const p = parseFloat(pos.market_prob) / 100;
            const entryPrice = pos.rec_side?.toUpperCase() === 'YES'
              ? (p > 0 ? p : 0.5) : (p < 1 ? 1 - p : 0.5);
            estimatedPnl = parseFloat(((1 / entryPrice - 1) * pos.stake_usd).toFixed(2));
          } else if (botWon === false) {
            estimatedPnl = -parseFloat(pos.stake_usd);
          }

          return {
            question:      pos.question,
            bot_bet:       pos.rec_side,
            stake:         pos.stake_usd,
            market_prob:   pos.market_prob + '%',
            yes_price_now: market?.yesPrice != null ? (market.yesPrice * 100).toFixed(1) + '%' : 'N/A',
            market_result: result,
            confidence,
            bot_acerto:    botWon === null ? '⏳ pendiente' : botWon ? '✅ SÍ' : '❌ NO',
            pnl_estimado:  estimatedPnl !== null ? (estimatedPnl >= 0 ? '+$' : '-$') + Math.abs(estimatedPnl) : null,
            created_at:    pos.created_at,
          };
        })
      );
      results.push(...batchResults);
    }

    const resolved  = results.filter(r => r.market_result !== 'pending' && r.market_result !== 'unknown');
    const wins      = resolved.filter(r => r.bot_acerto === '✅ SÍ');
    const losses    = resolved.filter(r => r.bot_acerto === '❌ NO');
    const pending   = results.filter(r => r.market_result === 'pending' || r.market_result === 'unknown');
    const totalPnl  = resolved.reduce((s, r) => {
      if (!r.pnl_estimado) return s;
      const n = parseFloat(r.pnl_estimado.replace(/[+$]/g, '').replace('-$', '-'));
      return s + (r.pnl_estimado.startsWith('-') ? -Math.abs(n) : Math.abs(n));
    }, 0);

    return res.json({
      resumen: {
        total_evaluadas:  results.length,
        resueltas:        resolved.length,
        ganadas:          wins.length,
        perdidas:         losses.length,
        pendientes:       pending.length,
        win_rate:         resolved.length ? (wins.length / resolved.length * 100).toFixed(1) + '%' : 'N/A',
        pnl_estimado:     (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2),
      },
      ganadas:   wins,
      perdidas:  losses,
      pendientes: pending.map(r => ({ question: r.question, bot_bet: r.bot_bet, yes_price_now: r.yes_price_now })),
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
