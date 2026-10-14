import 'dotenv/config';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

let adminKey = process.env.ADMIN_KEY;
if (!adminKey) {
  // Tanpa ADMIN_KEY, endpoint admin otomatis tidak bisa dipakai (kunci acak tiap start).
  adminKey = randomBytes(32).toString('hex');
  console.warn('ADMIN_KEY belum diisi: endpoint admin dinonaktifkan sampai variabel ini diatur.');
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  projectId: process.env.FIREBASE_PROJECT_ID || undefined,
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : undefined,
  adminKey,
  // Arahkan ke folder volume permanen di hosting agar sesi WA tidak hilang saat restart.
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || 'sessions'),
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
};
