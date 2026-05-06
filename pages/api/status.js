import { createClient } from '@supabase/supabase-js';
import { isValidSession } from './auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isValidSession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const FIX_DATE = '2026-04-30T00:00:00Z'; // desde cuando contar stats "post-fix"

    const [bankrollRes, openRes, closedRes, postFixRes] = await Promise.all([
      supabase.from('bankroll_state').select('*').single(),
      supabase.from('positions').select('*').eq('status', 'open').order('created_at', { ascending: false }),
      supabase.from('positions').select('*').eq('status', 'closed').order('created_at', { ascending: false }).limit(20),
      supabase.from('positions').select('pnl, outcome').eq('status', 'closed').gte('created_at', FIX_DATE),
    ]);

    if (bankrollRes.error) throw new Error(bankrollRes.error.message);
    if (openRes.error) throw new Error(openRes.error.message);
    if (closedRes.error) throw new Error(closedRes.error.message);

    const postFix = postFixRes.data || [];
    const totalPnl   = postFix.reduce((s, p) => s + parseFloat(p.pnl || 0), 0);
    const totalWins  = postFix.filter(p => p.outcome === 'win').length;
    const totalLosses = postFix.filter(p => p.outcome === 'loss').length;

    return res.json({
      bankroll: bankrollRes.data,
      openPositions: openRes.data || [],
      closedPositions: closedRes.data || [],
      stats: { totalPnl, totalWins, totalLosses, totalClosed: postFix.length, since: FIX_DATE },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
