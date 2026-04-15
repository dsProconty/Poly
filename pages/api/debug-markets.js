/**
 * Debug — pagina 300 mercados y muestra por qué se acepta/rechaza cada uno
 * GET /api/debug-markets
 */
const NON_SPORTS  = ['invade','invasion','taiwan','ceasefire','election','president','congress','senate','nuclear','war ','bitcoin','btc','ethereum','eth','crypto','gta','album','movie','rihanna','taylor','kanye','carti','playboi','rapper','jesus','christ','alien','hurricane','earthquake','openai','chatgpt','tesla'];
const FUTURES     = ['nba champion','nba mvp','super bowl','nfl champion','world series','mlb champion','stanley cup','nhl champion','win the league','win the pennant','win the season','la liga title','premier league title','bundesliga title','champions league winner','world cup winner','ballon d\'or','mvp award','rookie of the year','heisman','golden boot'];
const ESPORTS     = ['counter-strike','cs2','csgo','valorant','dota','league of legends','overwatch','rocket league','fortnite','pubg','esport'];
const SPORTS_CONFIRM = [' vs ',' v. ',' @ ','match winner','match result','moneyline','win the game','win the match','beats ','defeats ','beat ','defeat ','nba','nfl','mlb','nhl','mls','ufc','atp','wta','premier league','la liga','champions league','bundesliga','serie a','ncaa','copa america','wimbledon','us open','french open','australian open','ipl','cricket',' playoff',' playoffs','conference','semifinal','quarterfinal','advance','series'];

function classify(m) {
  const text = ((m.question || '') + ' ' + (m.title || '')).toLowerCase();
  if (FUTURES.some(k => text.includes(k)))        return 'REJECTED:futures';
  if (NON_SPORTS.some(k => text.includes(k)))     return 'REJECTED:non-sports';
  if (ESPORTS.some(k => text.includes(k)))        return 'REJECTED:esports';
  if (SPORTS_CONFIRM.some(k => text.includes(k))) return 'ACCEPTED';
  return 'REJECTED:no-keyword';
}

function parseYesPrice(m) {
  if (Array.isArray(m.tokens)) {
    const t = m.tokens.find(t => t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes');
    if (t?.price) return parseFloat(t.price);
  }
  let o = m.outcomes, p = m.outcomePrices;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = []; } }
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = []; } }
  if (Array.isArray(o) && Array.isArray(p)) {
    const idx = o.findIndex(x => (typeof x === 'string' ? x : x?.name || '').toLowerCase() === 'yes');
    if (idx >= 0) return parseFloat(p[idx]) || 0;
  }
  return 0;
}

export default async function handler(req, res) {
  try {
    const GAMMA   = 'https://gamma-api.polymarket.com';
    const MIN_VOL = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
    const MIN_P   = parseFloat(process.env.MIN_YES_PROB || '20');
    const MAX_P   = parseFloat(process.env.MAX_YES_PROB || '80');
    const MAX_DAYS = parseInt(process.env.MAX_DAYS_TO_RESOLVE || '60');

    // Paginar 300 mercados
    const pages = await Promise.all([0,1,2].map(i =>
      fetch(`${GAMMA}/markets?active=true&closed=false&archived=false&limit=100&offset=${i*100}&order=endDate&ascending=true`)
        .then(r => r.ok ? r.json() : []).catch(() => [])
    ));
    const raw = pages.flat();
    const seen = new Set();
    const unique = raw.filter(m => {
      const id = m.conditionId || m.condition_id;
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    });

    const analyzed = unique.map(m => {
      const yp  = parseYesPrice(m) * 100;
      const vol = parseFloat(m.volume) || 0;
      let status = classify(m);
      const endDate = m.endDate || m.end_date_iso;
      const diffDays = endDate ? (new Date(endDate) - new Date()) / 86400000 : 999;

      if (status === 'ACCEPTED') {
        if (vol < MIN_VOL)              status = 'REJECTED:low-volume(' + vol.toFixed(0) + ')';
        else if (yp < MIN_P || yp > MAX_P) status = 'REJECTED:prob(' + yp.toFixed(0) + '%)';
        else if (diffDays > MAX_DAYS)   status = 'REJECTED:too-far(' + diffDays.toFixed(0) + 'd)';
      }
      return { question: m.question, yesProb: yp.toFixed(1)+'%', volume: vol, endDate, diffDays: diffDays.toFixed(0)+'d', status };
    });

    const summary = analyzed.reduce((a, m) => { a[m.status] = (a[m.status]||0)+1; return a; }, {});
    const aceptados = analyzed.filter(m => m.status === 'ACCEPTED');

    return res.json({
      total_paginados: unique.length,
      filtros: { MIN_VOL, MIN_P, MAX_P, MAX_DAYS },
      resumen: summary,
      aceptados_count: aceptados.length,
      aceptados: aceptados,
      muestra_rechazados_no_keyword: analyzed.filter(m => m.status === 'REJECTED:no-keyword').slice(0,5).map(m => m.question),
      muestra_rechazados_futures: analyzed.filter(m => m.status === 'REJECTED:futures').slice(0,5).map(m => m.question),
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
