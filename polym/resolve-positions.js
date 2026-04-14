import { createClient } from '@supabase/supabase-js';
import { getMarketById } from '../lib/polymarket.js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const log = [];

  try {
    // 1. Obtener todas las posiciones abiertas
    const { data: openPositions, error } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'open');

    if (error) throw new Error(`Error leyendo posiciones: ${error.message}`);

    if (!openPositions?.length) {
      return res.json({ status: 'ok', message: 'Sin posiciones abiertas', resolved: 0 });
    }

    // 2. Obtener bankroll actual
    const { data: bankrollRow } = await supabase
      .from('bankroll_state')
      .select('*')
      .single();

    let cashDelta = 0; // acumulador de cambios al bankroll

    // 3. Verificar cada posición contra Polymarket
    for (const position of openPositions) {
      let marketData;

      try {
        marketData = await getMarketById(position.market_id);
      } catch (err) {
        log.push({ position_id: position.id, action: 'ERROR', reason: err.message });
        continue;
      }

      // Si el mercado no resolvió aún, ignorar
      if (!marketData.resolved || !marketData.outcome) {
        log.push({ position_id: position.id, market: position.question, action: 'PENDING' });
        continue;
      }

      // 4. Determinar outcome
      // rec_side es "YES" o "NO", outcome del mercado es "Yes" o "No"
      const marketOutcome = marketData.outcome; // "Yes" o "No"
      const betWon = position.rec_side?.toUpperCase() === marketOutcome?.toUpperCase();

      // Cálculo simple de PnL para paper trading:
      // - Si ganó: recupera el stake (asume pago 1:1 aproximado)
      // - Si perdió: pierde el stake
      // Nota: Polymarket paga según probabilidades reales (1/prob - 1)
      // Para paper trading simple usamos retorno estimado basado en market_prob
      let pnl;
      if (betWon) {
        // Retorno proporcional a la probabilidad implícita al momento de la apuesta
        const impliedOdds = position.market_prob > 0
          ? (100 / position.market_prob)
          : 2;
        pnl = parseFloat(((impliedOdds - 1) * position.stake_usd).toFixed(2));
      } else {
        pnl = -parseFloat(position.stake_usd);
      }

      // 5. Cerrar posición en DB
      const { error: updateErr } = await supabase
        .from('positions')
        .update({
          status: 'closed',
          outcome: betWon ? 'win' : 'loss',
          pnl,
          closed_at: new Date().toISOString(),
        })
        .eq('id', position.id);

      if (updateErr) {
        log.push({ position_id: position.id, action: 'ERROR_UPDATE', reason: updateErr.message });
        continue;
      }

      // Si ganó, devolver el stake + ganancia al bankroll
      // Si perdió, el stake ya fue descontado al colocar la apuesta — solo sumar ganancia si aplica
      if (betWon) {
        cashDelta += position.stake_usd + pnl; // recupera stake + ganancia
      }
      // En pérdida no se toca el cash (ya fue descontado al apostar)

      log.push({
        position_id: position.id,
        market: position.question,
        action: 'CLOSED',
        outcome: betWon ? 'win' : 'loss',
        stake: position.stake_usd,
        pnl,
      });
    }

    // 6. Actualizar bankroll con ganancias acumuladas
    if (cashDelta > 0) {
      const newCash = parseFloat((parseFloat(bankrollRow.available_cash) + cashDelta).toFixed(2));

      await supabase
        .from('bankroll_state')
        .update({
          available_cash: newCash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bankrollRow.id);
    }

    const resolved = log.filter(l => l.action === 'CLOSED').length;
    const wins = log.filter(l => l.outcome === 'win').length;
    const losses = log.filter(l => l.outcome === 'loss').length;
    const totalPnl = log
      .filter(l => l.action === 'CLOSED')
      .reduce((sum, l) => sum + (l.pnl || 0), 0);

    return res.json({
      status: 'ok',
      posicionesRevisadas: openPositions.length,
      resolved,
      wins,
      losses,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      cashDelta: parseFloat(cashDelta.toFixed(2)),
      results: log,
    });

  } catch (err) {
    console.error('[resolve-positions] Error crítico:', err);
    return res.status(500).json({ status: 'error', error: err.message, log });
  }
}
