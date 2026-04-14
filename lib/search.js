const TAVILY_URL = 'https://api.tavily.com/search';

/**
 * Busca información actualizada sobre un partido deportivo
 * para darle contexto real al Agente 1
 */
export async function searchMatchContext(question) {
  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: `${question} prediction injuries form stats`,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    });

    if (!res.ok) {
      console.warn(`[search] Tavily error: ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Combinar el answer + snippets de resultados en un texto corto
    const parts = [];
    if (data.answer) parts.push(data.answer);
    if (data.results?.length) {
      data.results.forEach(r => {
        if (r.content) parts.push(r.content.slice(0, 300));
      });
    }

    return parts.join('\n\n').slice(0, 1200) || null;
  } catch (err) {
    console.warn(`[search] Error buscando contexto: ${err.message}`);
    return null;
  }
}
