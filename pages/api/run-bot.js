import { createClient } from '@supabase/supabase-js';
import { getSportsMarkets } from '../../lib/polymarket.js';
import { analyzeMarket, getBankrollStake } from '../../lib/agents.js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_MARKETS_PER_RUN = 1; // 1 en Vercel Hobby (timeout 10s)

export default async function handler(req, res) {
  // Auth guard para cron jobs (opcional — solo activo si CRON_SECRET está definido)
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const log = [];

  try {
    // 1. Leer estado actual del bankroll
    const { data: bankrollRow, error: bankrollErr } = await supabase
      .from('bankroll_state')
      .select('*')
      .single();

    if (bankrollErr) throw new Error(`Error leyendo bankroll: ${bankrollErr.message}`);

    if (bankrollRow.available_cash < 1) {
      return res.json({ status: 'paused', reason: 'Cash disponible menor a $1', bankroll: bankrollRow });
    }

    // 2. Calcular exposición abierta
    const { data: openPositions } = await supabase
      .from('positions')
      .select('stake_usd')
      .eq('status', 'open');

    const openExposure = openPositions?.reduce((sum, p) => sum + parseFloat(p.stake_usd), 0) || 0;
    const openPositionsCount = openPositions?.length || 0;

    // Estado de bankroll para pasar a los agentes
    let bankroll = {
      availableCash: parseFloat(bankrollRow.available_cash),
      initialBankroll: parseFloat(bankrollRow.initial_bankroll),
      openPositionsCount,
      openExposure,
    };

    // 3. Obtener mercados deportivos de Polymarket
    const markets = await getSportsMarkets();

    if (!markets.length) {
      return res.json({ status: 'no_markets', message: 'Sin mercados deportivos activos con volumen suficiente' });
    }

    const candidates = markets.slice(0, MAX_MARKETS_PER_RUN);

    // 4. Procesar cada mercado candidato
    for (const market of candidates) {

      // Guardar cash antes de esta iteración
      const cashSnapshot = bankroll.availableCash;

      if (cashSnapshot < 1) {
        log.push({ market: market.question, action: 'SKIP', reason: 'Cash agotado durante la corrida' });
        break;
      }

      // AGENTE 1: ¿hay edge?
      let analysis;
      try {
        analysis = await analyzeMarket(market);
      } catch (err) {
        log.push({ market: market.question, action: 'ERROR_AGENT1', reason: err.message });
        continue;
      }

      if (analysis.skip || analysis.value === 'NONE') {
        log.push({ market: market.question, action: 'SKIP', reason: `Agente1: VALUE=${analysis.value}, SKIP=${analysis.skip}` });
        continue;
      }

      // AGENTE 2: ¿cuánto stake?
      let stakeDecision;
      try {
        stakeDecision = await getBankrollStake({ market, analysis, bankroll });
      } catch (err) {
        log.push({ market: market.question, action: 'ERROR_AGENT2', reason: err.message });
        continue;
      }

      // Validación de seguridad final
      const finalStake = Math.min(
        parseFloat(stakeDecision.stakeUsd.toFixed(2)),
        cashSnapshot
      );

      if (finalStake < 1) {
        log.push({ market: market.question, action: 'SKIP', reason: 'Stake calculado menor a $1' });
        continue;
      }

      // 5. Registrar posición en Supabase
      const [teamA, teamB] = market.question.split(' vs ').map(s => s.trim());

      const { data: position, error: posErr } = await supabase
        .from('positions')
        .insert({
          market_id: market.marketId,
          question: market.question,
          team_a: teamA,
          team_b: teamB,
          rec_side: analysis.recSide,
          rec_team: analysis.recTeam,
          rec_prob: analysis.recProb,
          market_prob: market.yesProb,
          stake_usd: finalStake,
          bankroll_reason: stakeDecision.reason,
          status: 'open',
        })
        .select()
        .single();

      if (posErr) {
        log.push({ market: market.question, action: 'ERROR_INSERT', reason: posErr.message });
        continue;
      }

      // 6. Log de decisión
      await supabase.from('trades_log').insert({
        position_id: position.id,
        agent1_response: analysis.raw,
        bankroll_response: stakeDecision.raw,
        stake_usd: finalStake,
      });

      // 7. Actualizar bankroll en DB
      const newCash = parseFloat((cashSnapshot - finalStake).toFixed(2));

      await supabase
        .from('bankroll_state')
        .update({
          available_cash: newCash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bankrollRow.id);

      // 8. Actualizar estado local para la siguiente iteración
      bankroll.availableCash = newCash;
      bankroll.openPositionsCount += 1;
      bankroll.openExposure += finalStake;

      log.push({
        market: market.question,
        action: 'BET',
        stake: finalStake,
        side: analysis.recSide,
        team: analysis.recTeam,
        reason: stakeDecision.reason,
        parseOk: stakeDecision.parseOk,
      });
    }

    return res.json({
      status: 'ok',
      marketsEvaluados: candidates.length,
      apuestasColocadas: log.filter(l => l.action === 'BET').length,
      cashRestante: bankroll.availableCash,
      results: log,
    });

  } catch (err) {
    console.error('[run-bot] Error crítico:', err);
    return res.status(500).json({ status: 'error', error: err.message, log });
  }
}
