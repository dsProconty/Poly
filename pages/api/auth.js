import { createHmac } from 'crypto';

const COOKIE_NAME = 'pb_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 días

function makeToken(password) {
  return createHmac('sha256', process.env.DASHBOARD_PASSWORD || 'secret')
    .update(password)
    .digest('hex');
}

export function isValidSession(req) {
  if (!process.env.DASHBOARD_PASSWORD) return true; // sin contraseña = abierto
  const cookie = req.cookies?.[COOKIE_NAME];
  const expected = makeToken(process.env.DASHBOARD_PASSWORD);
  return cookie === expected;
}

export default async function handler(req, res) {
  // POST /api/auth → login
  if (req.method === 'POST') {
    const { password } = req.body;

    if (!password || password !== process.env.DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = makeToken(password);
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}; Path=/`
    );
    return res.json({ ok: true });
  }

  // DELETE /api/auth → logout
  if (req.method === 'DELETE') {
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`
    );
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
