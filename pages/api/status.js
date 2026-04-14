import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [bankrollRes, positionsRes] = await Promise.all([
      supabase.from('bankroll_state').select('*').single(),
      supabase
        .from('positions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (bankrollRes.error) throw new Error(bankrollRes.error.message);
    if (positionsRes.error) throw new Error(positionsRes.error.message);

    const positions = positionsRes.data || [];

    return res.json({
      bankroll: bankrollRes.data,
      openPositions: positions.filter(p => p.status === 'open'),
      closedPositions: positions.filter(p => p.status === 'closed'),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
