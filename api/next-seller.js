const FALLBACK_SELLERS = [
  { label: 'alexandre', phone: '5547989010946' },
];

const CLEAN_MESSAGE = 'Olá, quero comprar em atacado!';
const VESTO_KEY = process.env.VESTO_PUBLIC_KEY || 'vpk_55fa13caded89a4138a54c2e5a26781e';
const VESTO_CONFIG_URL =
  process.env.VESTO_CONFIG_URL ||
  `https://backend-production-7a466.up.railway.app/api/public/meta/config?key=${encodeURIComponent(VESTO_KEY)}`;
const SEQ_KEY = process.env.SELLER_SEQ_KEY || 'valealto_seller_seq';

function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function incrGlobalSeq() {
  const redis = redisCreds();
  if (redis) {
    const res = await fetch(`${redis.url}/incr/${encodeURIComponent(SEQ_KEY)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` },
    });
    if (!res.ok) {
      throw new Error(`redis_incr_${res.status}`);
    }
    const data = await res.json();
    const seq = Number(data.result);
    if (!Number.isFinite(seq) || seq < 1) {
      throw new Error('redis_incr_invalid');
    }
    return { seq, store: 'redis' };
  }

  // Fallback por instância (com 1 vendedor o telefone continua correto).
  // Para rodízio real entre várias instâncias, configure KV/Upstash.
  globalThis.__valeAltoSellerSeq = (globalThis.__valeAltoSellerSeq || 0) + 1;
  return { seq: globalThis.__valeAltoSellerSeq, store: 'memory' };
}

async function loadSellers() {
  try {
    const res = await fetch(VESTO_CONFIG_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Vesto-Key': VESTO_KEY },
      cache: 'no-store',
    });
    if (!res.ok) return FALLBACK_SELLERS;
    const data = await res.json();
    const list =
      data.sellers ||
      data.whatsappSellers ||
      data.agents ||
      (Array.isArray(data) ? data : null);
    if (!Array.isArray(list) || !list.length) return FALLBACK_SELLERS;
    const normalized = list
      .map((item) => ({
        label: String(item.label || item.name || item.id || '').trim() || 'seller',
        phone: String(item.phone || item.whatsapp || item.number || '')
          .replace(/\D/g, ''),
      }))
      .filter((item) => item.phone.length >= 10);
    return normalized.length ? normalized : FALLBACK_SELLERS;
  } catch (_) {
    return FALLBACK_SELLERS;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const sellers = await loadSellers();
    const { seq, store } = await incrGlobalSeq();
    const index = (seq - 1) % sellers.length;
    const seller = sellers[index];

    return res.status(200).json({
      ok: true,
      phone: seller.phone,
      label: seller.label,
      index,
      total: sellers.length,
      seq,
      message: CLEAN_MESSAGE,
      store,
    });
  } catch (err) {
    const seller = FALLBACK_SELLERS[0];
    return res.status(200).json({
      ok: true,
      phone: seller.phone,
      label: seller.label,
      index: 0,
      total: FALLBACK_SELLERS.length,
      seq: 0,
      message: CLEAN_MESSAGE,
      store: 'fallback',
      error: err.message || 'next_seller_error',
    });
  }
};
