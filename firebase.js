import admin from 'firebase-admin';
import { config } from './config.js';

function buildCredential() {
  // Cara utama di hosting non-Google (Helipod): isi env FIREBASE_SERVICE_ACCOUNT_JSON
  // dengan seluruh isi file service account (JSON).
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    let account;
    try {
      account = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON bukan JSON yang valid');
    }
    if (account.private_key) {
      // Sebagian hosting menyimpan newline sebagai teks "\n".
      account.private_key = account.private_key.replace(/\\n/g, '\n');
    }
    return admin.credential.cert(account);
  }
  // Cadangan: GOOGLE_APPLICATION_CREDENTIALS atau kredensial bawaan hosting Google.
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: buildCredential(),
    ...(config.projectId ? { projectId: config.projectId } : {}),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
