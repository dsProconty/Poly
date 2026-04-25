import { getMarketById } from './polymarket.js';

export async function resolvePositions(supabase) {
  const log = [];

  const { data: openPositions, error } = await supabase
    .from('positions')
    .select('*')
    .eq('status', 'open');

  if (error) throw new Error(`Error leyendo posiciones: ${error.message}`);

  if (!openPositions?.length) {
    return { status: 'ok', message: 'Sin posiciones abiertas', resolved: 0 };
  }

  const { data: bankrollRow } = await supabase
    .from('bankroll_state')
    .select('*')
    .single();

  let cashDelta = 0;

  for (const position of openPositions) {
    let marketData;

    try {
      marketData = await getMarketById(position.market_id);
    } catch (err) {
      log.push({ position_id: position.id, action: 'ERROR', reason: err.message });
      continue;
    }

    // Inferir resultado: primero por resolución oficial, luego por precio del token
    let marketOutcome = null;
    if (marketData.resolved && marketData.outcome) {
      marketOutcome = marketData.outcome.toUpperCase();
    } else if (marketData.yesPrice !== null) {
      if (marketData.yesPrice > 0.95)      marketOutcome = 'YES';
      else if (marketData.yesPrice < 0.05) marketOutcome = 'NO';
    }

    if (!marketOutcome) {
      log.push({ position_id: position.id, market: position.question, action: 'PENDING', yesPrice: marketData.yesPrice });
      continue;
    }

    const betWon = position.rec_side?.toUpperCase() === marketOutcome;

    let pnl;
    if (betWon) {
      const p = parseFloat(position.market_prob) / 100;
      const entryPrice = position.rec_side?.toUpperCase() === 'YES'
        ? (p > 0 ? p : 0.5)
        : (p < 1 ? (1 - p) : 0.5);
      const netOdds = (1 / entryPrice) - 1;
      pnl = parseFloat((netOdds * parseFloat(position.stake_usd)).toFixed(2));
    } else {
      pnl = -parseFloat(position.stake_usd);
    }

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

    if (betWon) {
      cashDelta += position.stake_usd + pnl;
    }

    log.push({
      position_id: position.id,
      market: position.question,
      action: 'CLOSED',
      outcome: betWon ? 'win' : 'loss',
      stake: position.stake_usd,
      pnl,
    });
  }

  if (cashDelta > 0) {
    const newCash = parseFloat((parseFloat(bankrollRow.available_cash) + cashDelta).toFixed(2));
    await supabase
      .from('bankroll_state')
      .update({ available_cash: newCash, updated_at: new Date().toISOString() })
      .eq('id', bankrollRow.id);
  }

  const resolved = log.filter(l => l.action === 'CLOSED').length;
  const wins = log.filter(l => l.outcome === 'win').length;
  const losses = log.filter(l => l.outcome === 'loss').length;
  const totalPnl = log
    .filter(l => l.action === 'CLOSED')
    .reduce((sum, l) => sum + (l.pnl || 0), 0);

  return {
    status: 'ok',
    posicionesRevisadas: openPositions.length,
    resolved,
    wins,
    losses,
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    cashDelta: parseFloat(cashDelta.toFixed(2)),
    results: log,
  };
}
