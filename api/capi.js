const ALLOWED_EVENTS = new Set([
  'PageView',
  'Lead',
  'Contact',
  'ViewContent',
  'InitiateCheckout',
  'Purchase',
]);

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  const pixelId = process.env.META_PIXEL_ID || '2149605386435935';
  const apiVersion = process.env.META_API_VERSION || 'v21.0';

  if (!accessToken) {
    return res.status(500).json({ ok: false, error: 'META_ACCESS_TOKEN não configurado' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const eventName = body.event_name;
  const eventId = body.event_id;

  if (!ALLOWED_EVENTS.has(eventName)) {
    return res.status(400).json({ ok: false, error: `event_name inválido: ${eventName}` });
  }
  if (!eventId || typeof eventId !== 'string') {
    return res.status(400).json({ ok: false, error: 'event_id é obrigatório' });
  }

  const userData = {
    client_ip_address: clientIp(req),
    client_user_agent: req.headers['user-agent'] || '',
  };
  if (typeof body.fbp === 'string' && body.fbp) userData.fbp = body.fbp;
  if (typeof body.fbc === 'string' && body.fbc) userData.fbc = body.fbc;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: body.event_source_url || '',
        action_source: 'website',
        user_data: userData,
      },
    ],
    access_token: accessToken,
  };

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${apiVersion}/${pixelId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const meta = await metaRes.json();
    if (!metaRes.ok) {
      return res.status(metaRes.status).json({ ok: false, error: meta });
    }
    return res.status(200).json({ ok: true, meta });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao enviar CAPI' });
  }
};
