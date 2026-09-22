import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { R2Storage } from './storage.js';

const origins = process.argv.slice(2);
if (!origins.length) origins.push('http://localhost:5173', 'https://debate-wiki.vercel.app');
const storage = new R2Storage();
const url = await storage.createUploadUrl(`cors-verification/${randomUUID()}.zip`, 'application/zip');

for (const origin of origins) {
  const response = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  const allowedMethods = response.headers.get('access-control-allow-methods') || '';
  if (!response.ok || allowedOrigin !== origin || !allowedMethods.includes('PUT')) {
    throw new Error(`CORS preflight failed for ${origin}: status=${response.status}, allow-origin=${allowedOrigin}, allow-methods=${allowedMethods}`);
  }
  console.log(`CORS_VERIFIED=${origin}`);
}
