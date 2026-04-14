import { getSportsMarkets, getSportsMarketsFromMarkets } from './polymarket.js';
import { analyzeMarket, getBankrollStake } from './agents.js';
import { searchMatchContext } from './search.js';

const MAX_MARKETS_PER_RUN = parseInt(process.env.MAX_MARKETS_PER_RUN || '1');

export async function runBot(supabase) {
  const log = [];

  const { data: bankrollRow, error: bankrollErr } = await supabase
    .from('bankroll_state')
    .select('*')
    .single();

  if (bankrollErr) throw new Error(`Error leyendo bankroll: ${bankrollErr.message}`);

  if (bankrollRow.available_cash < 1) {
    return { status: 'paused', reason: 'Cash disponible menor a $1', bankroll: bankrollRow };
  }

  const { data: openPositions } = await supabase
    .from('positions')
    .select('stake_usd')
    .eq('status', 'open');

  const openExposure = openPositions?.reduce((sum, p) => sum + parseFloat(p.stake_usd), 0) || 0;
  const openPositionsCount = openPositions?.length || 0;

  let bankroll = {
    availableCash: parseFloat(bankrollRow.available_cash),
    initialBankroll: parseFloat(bankrollRow.initial_bankroll),
    openPositionsCount,
    openExposure,
  };

  // Intenta primero con /events (más específico), fallback a /markets
  let markets = await getSportsMarkets();
  let source = 'events';
  if (!markets.length) {
    markets = await getSportsMarketsFromMarkets();
    source = 'markets_fallback';
  }

  if (!markets.length) {
    return { status: 'no_markets', message: 'Sin mercados deportivos activos con probabilidad balanceada (15-85%)', source };
  }

  // Log de diagnóstico: qué mercados va a evaluar
  const preview = markets.slice(0, MAX_MARKETS_PER_RUN).map(m =>
    `[${m.sport}] ${m.question} (YES=${m.yesProb.toFixed(0)}%, vol=$${m.volume.toFixed(0)})`
  );

  const candidates = markets.slice(0, MAX_MARKETS_PER_RUN);

  for (const market of candidates) {
    const cashSnapshot = bankroll.availableCash;

    if (cashSnapshot < 1) {
      log.push({ market: market.question, action: 'SKIP', reason: 'Cash agotado durante la corrida' });
      break;
    }

    // Búsqueda de contexto real del partido via Tavily (query estructurada por deporte)
    const context = await searchMatchContext(market);

    let analysis;
    try {
      analysis = await analyzeMarket(market, context);
    } catch (err) {
      log.push({ market: market.question, action: 'ERROR_AGENT1', reason: err.message });
      continue;
    }

    if (analysis.skip || analysis.value === 'NONE') {
      log.push({ market: market.question, action: 'SKIP', reason: `Agente1: VALUE=${analysis.value}, SKIP=${analysis.skip}` });
      continue;
    }

    let stakeDecision;
    try {
      stakeDecision = await getBankrollStake({ market, analysis, bankroll });
    } catch (err) {
      log.push({ market: market.question, action: 'ERROR_AGENT2', reason: err.message });
      continue;
    }

    const finalStake = Math.min(
      parseFloat(stakeDecision.stakeUsd.toFixed(2)),
      cashSnapshot
    );

    if (finalStake < 1) {
      log.push({ market: market.question, action: 'SKIP', reason: 'Stake calculado menor a $1' });
      continue;
    }

    const parts = market.question.split(' vs ').map(s => s.trim());
    const teamA = parts[0] || market.question;
    const teamB = parts[1] || null;

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

    await supabase.from('trades_log').insert({
      position_id: position.id,
      agent1_response: analysis.raw,
      bankroll_response: stakeDecision.raw,
      stake_usd: finalStake,
    });

    const newCash = parseFloat((cashSnapshot - finalStake).toFixed(2));

    await supabase
      .from('bankroll_state')
      .update({ available_cash: newCash, updated_at: new Date().toISOString() })
      .eq('id', bankrollRow.id);

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

  return {
    status: 'ok',
    source,
    mercadosDisponibles: markets.length,
    marketsEvaluados: candidates.length,
    mercadosPreview: preview,
    apuestasColocadas: log.filter(l => l.action === 'BET').length,
    cashRestante: bankroll.availableCash,
    results: log,
  };
}
