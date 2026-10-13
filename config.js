
import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  projectId: process.env.FIREBASE_PROJECT_ID || undefined,
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : undefined,
  sessionsDir: path.resolve('sessions'),
  dataDir: path.resolve('data'),
};
