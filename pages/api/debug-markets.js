/**
 * Endpoint de debug — muestra qué devuelve la API de Polymarket
 * Usa /events (más específico) con fallback a /markets
 * Acceder en: /api/debug-markets
 */
function parseYesPrice(m) {
  if (Array.isArray(m.tokens)) {
    const t = m.tokens.find(t =>
      t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes'
    );
    if (t?.price) return parseFloat(t.price);
  }
  let outcomes = m.outcomes;
  let prices = m.outcomePrices;
  if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; } }
  if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch { prices = []; } }
  if (Array.isArray(outcomes) && Array.isArray(prices)) {
    const idx = outcomes.findIndex(o =>
      (typeof o === 'string' ? o : o?.name || '').toLowerCase() === 'yes'
    );
    if (idx >= 0) return parseFloat(prices[idx]) || 0;
  }
  return 0;
}

export default async function handler(req, res) {
  try {
    const minVolume = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
    const requireVs = process.env.REQUIRE_VS_FORMAT !== 'false';
    const minYesProb = parseFloat(process.env.MIN_YES_PROB || '15');
    const maxYesProb = parseFloat(process.env.MAX_YES_PROB || '85');

    // ── Probar endpoint /events ──────────────────────────────
    const eventsRes = await fetch(
      `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=sports&limit=50`
    );
    const events = eventsRes.ok ? await eventsRes.json() : [];

    const fromEvents = [];
    for (const event of (events || [])) {
      for (const m of (event.markets || [])) {
        const vol = parseFloat(m.volume) || parseFloat(event.volume) || 0;
        const question = m.question || event.title || '';
        const yesPrice = parseYesPrice(m);
        fromEvents.push({
          question,
          eventTitle: event.title,
          volume: vol,
          yesProb: (yesPrice * 100).toFixed(1) + '%',
          yesProbNum: yesPrice * 100,
          hasVs: question.includes(' vs '),
          endDate: m.endDate || event.endDate,
        });
      }
    }

    // Aplicar filtros
    const candidatos = fromEvents
      .filter(m => {
        const hasVs = requireVs ? m.hasVs : true;
        return m.volume > minVolume && hasVs && m.yesProbNum >= minYesProb && m.yesProbNum <= maxYesProb;
      })
      .sort((a, b) => b.volume - a.volume);

    return res.json({
      source: 'events',
      total_eventos: events.length,
      total_mercados_en_eventos: fromEvents.length,
      candidatos_para_bot: candidatos.length,
      filtros_activos: { minVolume, requireVs, minYesProb, maxYesProb },
      top5_candidatos: candidatos.slice(0, 5).map(({ question, yesProb, volume, endDate }) => ({
        question, yesProb, volume, endDate
      })),
      todos_sin_filtro_prob: fromEvents
        .filter(m => m.volume > minVolume && (requireVs ? m.hasVs : true))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 10)
        .map(({ question, yesProb, volume }) => ({ question, yesProb, volume })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
