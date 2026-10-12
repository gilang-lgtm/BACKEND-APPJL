import express from 'express';
import { config } from './config.js';
import { db } from './firebase.js';
import { connectSales, disconnectSales, getQr, getSession, listSessions, restoreSessions } from './session-manager.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

function requireAdmin(req, res, next) {
  const supplied = req.get('x-erra-admin-key') || '';
  if (supplied.length !== config.adminKey.length || !safeEqual(supplied, config.adminKey)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}
function safeEqual(a, b) {
  // Perbandingan panjang sudah dicek agar timingSafeEqual tidak melempar error.
  return cryptoTimingSafeEqual(a, b);
}
import { timingSafeEqual } from 'node:crypto';
function cryptoTimingSafeEqual(a, b) { return timingSafeEqual(Buffer.from(a), Buffer.from(b)); }

app.get('/health', (_req, res) => res.json({ ok: true, service: 'erra-auto-lead', time: new Date().toISOString() }));
app.get('/api/sessions', requireAdmin, (_req, res) => res.json({ ok: true, sessions: listSessions() }));

// Hubungkan/daftarkan nomor WhatsApp untuk UID sales tertentu.
app.post('/api/sessions', requireAdmin, async (req, res) => {
  try {
    const { salesId, salesName, branch } = req.body || {};
    if (!salesId || !salesName || !branch) return res.status(400).json({ ok: false, error: 'salesId, salesName, dan branch wajib diisi' });
    // Pastikan UID benar-benar ada dan datanya diambil dari collection users.
    const userDoc = await db.collection('users').doc(String(salesId)).get();
    if (!userDoc.exists) return res.status(404).json({ ok: false, error: 'UID tidak ditemukan pada collection users' });
    const user = userDoc.data();
    if (String(user.role || '').toLowerCase() !== 'sales') return res.status(400).json({ ok: false, error: 'Dokumen users tersebut bukan role Sales' });
    const actualName = String(user.name || salesName).trim();
    const actualBranch = String(user.branch || branch).trim();
    const session = await connectSales({ salesId: String(salesId), salesName: actualName, branch: actualBranch });
    return res.status(201).json({ ok: true, session, qrEndpoint: `/api/sessions/${encodeURIComponent(salesId)}/qr` });
  } catch (err) {
    console.error('POST /api/sessions:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  }
});

app.get('/api/sessions/:salesId', requireAdmin, (req, res) => {
  const session = getSession(req.params.salesId);
  if (!session) return res.status(404).json({ ok: false, error: 'Sesi tidak ditemukan' });
  res.json({ ok: true, session });
});

app.get('/api/sessions/:salesId/qr', requireAdmin, (req, res) => {
  const qr = getQr(req.params.salesId);
  if (!qr) return res.status(404).json({ ok: false, error: 'QR belum tersedia. Periksa status sesi atau tunggu QR baru.' });
  res.json({ ok: true, qrDataUrl: qr });
});

app.delete('/api/sessions/:salesId', requireAdmin, async (req, res) => {
  try {
    const logout = String(req.query.logout || 'false') === 'true';
    const result = await disconnectSales(req.params.salesId, logout);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(404).json({ ok: false, error: err.message }); }
});

app.get('/api/firestore-check', requireAdmin, async (_req, res) => {
  try {
    const snap = await db.collection('users').limit(1).get();
    res.json({ ok: true, firestore: 'connected', usersCollectionReadable: true, sampleCount: snap.size });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.listen(config.port, config.host, async () => {
  console.log(`Erra Auto Lead listening on ${config.host}:${config.port}`);
  await restoreSessions();
});
