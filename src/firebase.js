import admin from 'firebase-admin';
import { config } from './config.js';

if (!admin.apps.length) {
  // Firebase Admin memakai GOOGLE_APPLICATION_CREDENTIALS atau kredensial environment hosting.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...(config.projectId ? { projectId: config.projectId } : {}),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
