import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { IncomingMessage } from 'node:http';

export interface AdminIdentity { uid: string; email: string }

function firebaseApp() {
  if (getApps().length) return getApps()[0];
  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawCredentials) {
    const credentials = JSON.parse(rawCredentials);
    return initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  return initializeApp({ projectId });
}

export async function requireAdmin(request: IncomingMessage): Promise<AdminIdentity> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AuthError(401, 'Authentication is required.');
  let token;
  try { token = await getAuth(firebaseApp()).verifyIdToken(header.slice(7)); }
  catch { throw new AuthError(401, 'The authentication token is invalid or expired.'); }

  const email = token.email?.toLowerCase();
  const allowedEmails = new Set((process.env.ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!email || (token.admin !== true && !allowedEmails.has(email))) throw new AuthError(403, 'Administrator access is required.');
  return { uid: token.uid, email };
}

export class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
