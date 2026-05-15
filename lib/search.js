const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Construye una query estructurada para buscar contexto de un partido.
 * Igual al approach de Perplexity Sonar del SussyImplementation.
 */
function buildStructuredQuery(market) {
  const { question, sport } = market;

  // Extraer equipos/jugadores de la pregunta
  // Soporta: "Will A beat B?", "A vs B", "Will A win?"
  let teamA = '', teamB = '';

  const vsMatch = question.match(/(.+?)\s+vs\.?\s+(.+?)(?:\?|$)/i);
  const beatMatch = question.match(/will\s+(.+?)\s+(?:beat|defeat)\s+(.+?)(?:\?|$)/i);
  const winMatch = question.match(/will\s+(.+?)\s+win/i);

  if (vsMatch) {
    teamA = vsMatch[1].replace(/^will\s+/i, '').trim();
    teamB = vsMatch[2].trim();
  } else if (beatMatch) {
    teamA = beatMatch[1].trim();
    teamB = beatMatch[2].trim();
  } else if (winMatch) {
    teamA = winMatch[1].trim();
  }

  // Query estructurada según el deporte
  if (sport === 'TENNIS') {
    return `${question}. Provide:
1. ${teamA || 'Player A'} recent match results and current ranking
2. ${teamA || 'Player A'} injuries or physical condition
3. ${teamB ? teamB + ' recent match results and current ranking' : ''}
4. ${teamB ? teamB + ' injuries or physical condition' : ''}
5. Head-to-head record between them
6. Current form and surface preference`;
  }

  if (['SOCCER', 'EPL', 'LA_LIGA', 'CHAMPIONS_LEAGUE'].includes(sport)) {
    return `${question}. Provide:
1. ${teamA || 'Team A'} last 5 match results and current form
2. ${teamA || 'Team A'} key injuries or suspensions
3. ${teamB ? teamB + ' last 5 match results and current form' : ''}
4. ${teamB ? teamB + ' key injuries or suspensions' : ''}
5. Head-to-head record (last 5 meetings)
6. Home/away advantage and current standings`;
  }

  if (['NBA', 'NCAA'].includes(sport)) {
    return `${question}. Provide:
1. ${teamA || 'Team A'} recent results, win/loss streak
2. ${teamA || 'Team A'} injuries and player availability
3. ${teamB ? teamB + ' recent results, win/loss streak' : ''}
4. ${teamB ? teamB + ' injuries and player availability' : ''}
5. Head-to-head record this season
6. Home court advantage and standings`;
  }

  if (sport === 'MMA') {
    return `${question}. Provide:
1. ${teamA || 'Fighter A'} recent fight results and record
2. ${teamA || 'Fighter A'} fighting style and strengths
3. ${teamB ? teamB + ' recent fight results and record' : ''}
4. ${teamB ? teamB + ' fighting style and strengths' : ''}
5. Head-to-head matchup analysis
6. Weight class and venue`;
  }

  // Query genérica para otros deportes
  return `${question}. Provide:
1. ${teamA || 'Team/Player A'} recent results and current form
2. ${teamA || 'Team/Player A'} injuries or issues
3. ${teamB ? teamB + ' recent results and current form' : ''}
4. ${teamB ? teamB + ' injuries or issues' : ''}
5. Head-to-head history
6. Key factors that could influence the outcome`;
}

/**
 * Busca información actualizada sobre un partido deportivo.
 * Usa queries estructuradas por deporte para mayor relevancia.
 */
export async function searchMatchContext(market) {
  // Compatibilidad: acepta string (legacy) u objeto market
  const isLegacy = typeof market === 'string';
  const question = isLegacy ? market : (market.question || market);
  const sport = isLegacy ? 'SPORTS' : (market.sport || 'SPORTS');

  const query = isLegacy
    ? `${question} match prediction injuries recent form stats`
    : buildStructuredQuery({ question, sport });

  if (!process.env.BRAVE_API_KEY) {
    console.warn('[search] BRAVE_API_KEY no configurada — sin contexto externo');
    return null;
  }

  try {
    const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=5&search_lang=en&freshness=pd`; // pd = last 24h
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
    });

    if (!res.ok) {
      console.warn(`[search] Brave error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const results = data?.web?.results || [];

    const parts = results.map(r =>
      [r.title, r.description].filter(Boolean).join(' — ')
    );

    return parts.join('\n\n').slice(0, 1500) || null;
  } catch (err) {
    console.warn(`[search] Error buscando contexto: ${err.message}`);
    return null;
  }
}
