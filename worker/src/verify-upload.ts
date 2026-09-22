import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { CardRepository } from './database.js';
import { ingest } from './ingest.js';
import { R2Storage } from './storage.js';
import { UploadRepository } from './uploads.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run upload:verify -- C:\\path\\to\\archive.zip');
const path = resolve(input);
const archiveName = basename(path);
const bytes = new Uint8Array(await readFile(path));
const storageKey = `archives/verification/${randomUUID()}-${archiveName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
const origins = [...new Set(['http://localhost:5173', 'http://127.0.0.1:5173', process.env.CORS_ORIGIN].filter((value): value is string => !!value))];

const storage = new R2Storage();
await storage.verifyBucket();
console.log('R2_BUCKET_VERIFIED');
try {
  await storage.configureUploadCors(origins);
  console.log(`R2_CORS_CONFIGURED=${origins.join(',')}`);
} catch (error: any) {
  if (error?.name !== 'AccessDenied') throw error;
  console.log('R2_CORS_REQUIRES_ADMIN_TOKEN');
}

const uploadUrl = await storage.createUploadUrl(storageKey, 'application/zip');
const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: bytes });
if (!upload.ok) throw new Error(`Signed R2 upload failed with ${upload.status}: ${await upload.text()}`);
console.log(`R2_UPLOAD_COMPLETE=${bytes.byteLength}`);

const downloaded = await storage.download(storageKey);
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
if (hash(bytes) !== hash(downloaded)) throw new Error('Downloaded R2 object does not match the uploaded archive.');
console.log('R2_DOWNLOAD_VERIFIED');

const uploads = new UploadRepository();
const repository = new CardRepository();
try {
  const jobId = await uploads.createJob(archiveName, storageKey, 'pipeline-verification');
  const summary = await ingest(downloaded, archiveName, { repository, storageKey, jobId, onProgress: message => console.log(message) });
  const job = await uploads.getJob(jobId);
  console.log(JSON.stringify({ storageKey, summary, job }, null, 2));
} finally {
  await uploads.pool.end();
  await repository.close();
}
