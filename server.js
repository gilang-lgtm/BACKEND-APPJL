import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { config } from './config.js';
import { db } from './firebase.js';
import { connectSales, disconnectSales, getQr, getSession, listSessions, restoreSessions } from './session-manager.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// ---------- Auth ----------

// Untuk endpoint khusus admin/maintenance (tetap pakai admin key).
function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
function requireAdmin(req, res, next) {
  const supplied = req.get('x-erra-admin-key') || '';
  if (!supplied || !safeEqual(supplied, config.adminKey)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// Untuk app Flutter: verifikasi Firebase ID token, UID diambil dari token.
async function requireUser(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer (.+)$/i);
  if (!match) return res.status(401).json({ ok: false, error: 'Token login tidak ada' });
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Token login tidak valid atau kedaluwarsa' });
  }
}

// Sales hanya boleh mengakses sesi miliknya sendiri.
function requireOwner(req, res, next) {
  if (req.params.salesId !== req.uid) {
    return res.status(403).json({ ok: false, error: 'Tidak boleh mengakses sesi sales lain' });
  }
  next();
}

// ---------- Routes ----------

app.get('/health', (_req, res) => res.json({ ok: true, service: 'erra-auto-lead', time: new Date().toISOString() }));

app.get('/api/sessions', requireAdmin, (_req, res) => res.json({ ok: true, sessions: listSessions() }));

// Hubungkan WhatsApp untuk sales yang sedang login (UID dari token).
app.post('/api/sessions', requireUser, async (req, res) => {
  try {
    const salesId = req.uid;
    const userDoc = await db.collection('users').doc(salesId).get();
    if (!userDoc.exists) return res.status(404).json({ ok: false, error: 'UID tidak ditemukan pada collection users' });
    const user = userDoc.data();
    if (String(user.role || '').toLowerCase() !== 'sales') {
      return res.status(403).json({ ok: false, error: 'Akun ini bukan role Sales' });
    }
    const salesName = String(user.name || '').trim();
    const branch = String(user.branch || '').trim();
    if (!salesName || !branch) {
      return res.status(400).json({ ok: false, error: 'Data nama/cabang sales belum lengkap di collection users' });
    }
    const session = await connectSales({ salesId, salesName, branch });
    return res.status(201).json({ ok: true, session, qrEndpoint: `/api/sessions/${encodeURIComponent(salesId)}/qr` });
  } catch (err) {
    console.error('POST /api/sessions:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  }
});

app.get('/api/sessions/:salesId', requireUser, requireOwner, (req, res) => {
  const session = getSession(req.params.salesId);
  if (!session) return res.status(404).json({ ok: false, error: 'Sesi tidak ditemukan' });
  res.json({ ok: true, session });
});

app.get('/api/sessions/:salesId/qr', requireUser, requireOwner, (req, res) => {
  const qr = getQr(req.params.salesId);
  if (!qr) return res.status(404).json({ ok: false, error: 'QR belum tersedia. Periksa status sesi atau tunggu QR baru.' });
  res.json({ ok: true, qrDataUrl: qr });
});

app.delete('/api/sessions/:salesId', requireUser, requireOwner, async (req, res) => {
  try {
    const logout = String(req.query.logout || 'false') === 'true';
    const result = await disconnectSales(req.params.salesId, logout);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(404).json({ ok: false, error: err.message }); }
});

// TODO: GET /api/sessions/:salesId/leads/lookup?phone=...
// (menunggu session-manager.js / file handler pesan untuk tahu di mana data lead disimpan)

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
