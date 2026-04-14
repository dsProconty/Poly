/**
 * Proxy interno para el dashboard.
 * Reenvía la acción al endpoint correspondiente incluyendo
 * el Authorization header si CRON_SECRET está configurado.
 * Este endpoint NO es un cron job — no necesita auth guard propio.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;
  if (!action || !['run-bot', 'resolve'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser "run-bot" o "resolve"' });
  }

  const endpoint = action === 'resolve' ? '/api/resolve-positions' : '/api/run-bot';

  // APP_URL tiene prioridad (configurar en Vercel env vars)
  // VERCEL_URL es el hostname automático por deployment (fallback)
  const baseUrl = process.env.APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'http://localhost:3000';

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
  }

  try {
    const upstream = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
