import 'dotenv/config';
import { createServer } from 'node:http';
import { CardRepository } from './database.js';
import { ingest } from './ingest.js';
import { R2Storage } from './storage.js';
import { SearchRepository, type SearchSort } from './search.js';
import { randomUUID } from 'node:crypto';
import { AuthError, requireAdmin } from './auth.js';
import { UploadRepository } from './uploads.js';
import { PubSub } from '@google-cloud/pubsub';
import { buildStoredCardDocx } from './download.js';

interface JobMessage { jobId: string; storageKey: string; archiveName: string }
const port = Number(process.env.PORT || 8080);
const serviceRole = process.env.SERVICE_ROLE || 'combined';
const searchRepository = new SearchRepository();
const uploadRepository = new UploadRepository();

createServer(async (request, response) => {
  setCors(request, response);
  if (request.method === 'OPTIONS') return json(response, 204, null);
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
  if (serviceRole === 'worker' && !(request.method === 'POST' && url.pathname === '/ingest')) return json(response, 404, { error: 'Not found' });
  if (url.pathname.startsWith('/api/admin/') && serviceRole !== 'local') return json(response, 404, { error: 'Not found' });
  if (url.pathname.startsWith('/api/admin/') && !adminOriginAllowed(request)) return json(response, 403, { error: 'Administrator tools are restricted to localhost.' });
  if (request.method === 'GET' && url.pathname === '/api/cards') {
    try { return json(response, 200, await searchRepository.search(searchInput(url.searchParams))); }
    catch (error) { return apiError(response, error); }
  }
  if (request.method === 'GET' && url.pathname === '/api/filters') {
    try { return json(response, 200, await searchRepository.filters()); }
    catch (error) { return apiError(response, error); }
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/me') {
    try { const admin = await requireAdmin(request); return json(response, 200, { isAdmin: true, email: admin.email }); }
    catch (error) { return apiError(response, error); }
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/uploads/presign') {
    try {
      const admin = await requireAdmin(request);
      const body = JSON.parse(await readBody(request));
      const archiveName = validArchiveName(body.archiveName);
      const size = integer(String(body.size), 0, 1, 2 * 1024 * 1024 * 1024);
      const storageKey = `archives/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeObjectName(archiveName)}`;
      const uploadUrl = await new R2Storage().createUploadUrl(storageKey, body.contentType || 'application/zip');
      const jobId = await uploadRepository.createJob(archiveName, storageKey, admin.email);
      return json(response, 201, { jobId, storageKey, uploadUrl, size });
    } catch (error) { return apiError(response, error); }
  }
  if (request.method === 'POST' && url.pathname.match(/^\/api\/admin\/uploads\/[0-9a-f-]{36}\/complete$/i)) {
    try {
      await requireAdmin(request);
      const jobId = url.pathname.split('/')[4];
      const job = await uploadRepository.getJob(jobId);
      if (!job) throw new HttpError(404, 'Ingestion job not found.');
      if (job.status !== 'queued') throw new HttpError(409, `Job is already ${job.status}.`);
      const message = { jobId, storageKey: job.storageKey, archiveName: job.archiveName };
      if (serviceRole === 'local') {
        void dispatchIngestion(message).catch(async error => {
          const repository = new CardRepository();
          try { await repository.failJob(jobId, error); }
          finally { await repository.close(); }
          console.error('Local ingestion failed:', error);
        });
      } else {
        await dispatchIngestion(message);
      }
      return json(response, 202, { jobId, status: 'processing' });
    } catch (error) { return apiError(response, error); }
  }
  const jobMatch = request.method === 'GET' && url.pathname.match(/^\/api\/admin\/jobs\/([0-9a-f-]{36})$/i);
  if (jobMatch) {
    try { await requireAdmin(request); const job = await uploadRepository.getJob(jobMatch[1]); return job ? json(response, 200, job) : json(response, 404, { error: 'Job not found' }); }
    catch (error) { return apiError(response, error); }
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/jobs') {
    try { await requireAdmin(request); return json(response, 200, { items: await uploadRepository.listJobs() }); }
    catch (error) { return apiError(response, error); }
  }
  const cardMatch = request.method === 'GET' && url.pathname.match(/^\/api\/cards\/([0-9a-f-]{36})$/i);
  if (cardMatch) {
    try {
      const card = await searchRepository.getCard(cardMatch[1]);
      return card ? json(response, 200, card) : json(response, 404, { error: 'Card not found' });
    } catch (error) { return apiError(response, error); }
  }
  const downloadMatch = request.method === 'GET' && url.pathname.match(/^\/api\/cards\/([0-9a-f-]{36})\/download$/i);
  if (downloadMatch) {
    try {
      const sourceId = url.searchParams.get('sourceId') || undefined;
      if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) throw new HttpError(400, 'Invalid sourceId.');
      const source = await searchRepository.getDownloadSource(downloadMatch[1], sourceId);
      if (!source) return json(response, 404, { error: 'Card source not found' });
      const file = await buildStoredCardDocx(source);
      response.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${file.filename}"`,
        'content-length': String(file.bytes.byteLength),
        'cache-control': 'private, no-store',
      });
      return response.end(file.bytes);
    } catch (error) { return apiError(response, error); }
  }
  if (request.method !== 'POST' || url.pathname !== '/ingest' || serviceRole === 'api') return json(response, 404, { error: 'Not found' });

  if (process.env.WORKER_SHARED_SECRET && request.headers.authorization !== `Bearer ${process.env.WORKER_SHARED_SECRET}`) {
    return json(response, 401, { error: 'Invalid worker credential.' });
  }

  let repository: CardRepository | undefined;
  let message: JobMessage | undefined;
  try {
    message = parseMessage(await readBody(request));
    repository = new CardRepository();
    const bytes = await new R2Storage().download(message.storageKey);
    const summary = await ingest(bytes, message.archiveName, { repository, storageKey: message.storageKey, jobId: message.jobId });
    return json(response, 200, summary);
  } catch (error) {
    if (repository && message?.jobId) await repository.failJob(message.jobId, error).catch(() => undefined);
    return json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  } finally {
    await repository?.close();
  }
}).listen(port, () => console.log(`Card API and ingestion worker listening on ${port}`));

function searchInput(params: URLSearchParams) {
  const page = integer(params.get('page'), 1, 1, 100000);
  const limit = integer(params.get('limit'), 25, 1, 100);
  const yearMin = optionalInteger(params.get('yearMin'), 1900, 2100);
  const yearMax = optionalInteger(params.get('yearMax'), 1900, 2100);
  if (yearMin && yearMax && yearMin > yearMax) throw new HttpError(400, 'yearMin cannot exceed yearMax.');
  const requestedSort = params.get('sort') || (params.get('q')?.trim() ? 'relevance' : 'newest');
  const sorts: SearchSort[] = ['relevance', 'year-new', 'year-old', 'newest'];
  if (!sorts.includes(requestedSort as SearchSort)) throw new HttpError(400, 'Invalid sort value.');
  const requestedScope = params.get('scope') || 'all';
  if (!['all', 'tag', 'cite', 'body'].includes(requestedScope)) throw new HttpError(400, 'Invalid scope value.');
  return {
    query: limited(params.get('q'), 500) ?? '', page, limit, yearMin, yearMax,
    author: limited(params.get('author'), 100),
    collection: limited(params.get('collection'), 200),
    school: limited(params.get('school'), 200),
    teamName: limited(params.get('teamName'), 200),
    sort: requestedSort as SearchSort,
    scope: requestedScope as 'all' | 'tag' | 'cite' | 'body',
  };
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function integer(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, 'Invalid numeric parameter.');
  const result = Number(value);
  if (result < min || result > max) throw new HttpError(400, `Numeric parameter must be between ${min} and ${max}.`);
  return result;
}
function optionalInteger(value: string | null, min: number, max: number) { return value === null || value === '' ? undefined : integer(value, min, min, max); }
function limited(value: string | null, max: number) {
  const result = value?.trim() || undefined;
  if (result && result.length > max) throw new HttpError(400, `Parameter cannot exceed ${max} characters.`);
  return result;
}
function apiError(response: import('node:http').ServerResponse, error: unknown) {
  const status = error instanceof HttpError || error instanceof AuthError ? error.status : 500;
  return json(response, status, { error: error instanceof Error ? error.message : String(error) });
}

function validArchiveName(value: unknown) {
  if (typeof value !== 'string' || !/\.(zip|docx)$/i.test(value) || value.length > 240) throw new HttpError(400, 'A valid .zip or .docx archiveName is required.');
  return value;
}
function safeObjectName(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, '_'); }
async function dispatchIngestion(message: JobMessage) {
  if (serviceRole === 'local') {
    const repository = new CardRepository();
    try {
      const bytes = await new R2Storage().download(message.storageKey);
      await ingest(bytes, message.archiveName, { repository, storageKey: message.storageKey, jobId: message.jobId });
    } finally { await repository.close(); }
    return;
  }
  if (process.env.PUBSUB_TOPIC) {
    await new PubSub().topic(process.env.PUBSUB_TOPIC).publishMessage({ json: message });
    return;
  }
  const target = process.env.WORKER_INGEST_URL;
  if (target) {
    const response = await fetch(target, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.WORKER_SHARED_SECRET ? { authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}` } : {}) },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`Worker dispatch failed with ${response.status}.`);
    return;
  }
  const repository = new CardRepository();
  try {
    const bytes = await new R2Storage().download(message.storageKey);
    await ingest(bytes, message.archiveName, { repository, storageKey: message.storageKey, jobId: message.jobId });
  } finally { await repository.close(); }
}
function configuredOrigins(name: string, fallback: string) {
  return (process.env[name] || fallback).split(',').map(value => value.trim()).filter(Boolean);
}
function setCors(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  const origin = request.headers.origin;
  const allowed = configuredOrigins('CORS_ORIGIN', 'http://localhost:5173,http://127.0.0.1:5173');
  if (origin && allowed.includes(origin)) response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,authorization');
  response.setHeader('access-control-expose-headers', 'content-disposition');
}
function adminOriginAllowed(request: import('node:http').IncomingMessage) {
  const origin = request.headers.origin;
  return !!origin && configuredOrigins('ADMIN_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').includes(origin);
}

function parseMessage(body: string): JobMessage {
  const envelope = JSON.parse(body);
  const value = envelope?.message?.data
    ? JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8'))
    : envelope;
  if (!value?.jobId || !value?.storageKey || !value?.archiveName) throw new Error('jobId, storageKey, and archiveName are required.');
  return value;
}

async function readBody(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
