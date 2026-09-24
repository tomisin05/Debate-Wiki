import 'dotenv/config';
import { createServer } from 'node:http';
import { buildStoredCardDocx } from './download.js';
import { SearchRepository, type SearchSort } from './search.js';

const port = Number(process.env.PORT || 8080);
const repository = new SearchRepository();

const server = createServer(async (request, response) => {
  setCors(request, response);
  if (request.method === 'OPTIONS') return json(response, 204, null);

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });

  if (request.method === 'GET' && url.pathname === '/api/cards') {
    try { return json(response, 200, await repository.search(searchInput(url.searchParams))); }
    catch (error) { return apiError(response, error); }
  }

  if (request.method === 'GET' && url.pathname === '/api/filters') {
    try { return json(response, 200, await repository.filters()); }
    catch (error) { return apiError(response, error); }
  }

  const cardMatch = request.method === 'GET' && url.pathname.match(/^\/api\/cards\/([0-9a-f-]{36})$/i);
  if (cardMatch) {
    try {
      const card = await repository.getCard(cardMatch[1]);
      return card ? json(response, 200, card) : json(response, 404, { error: 'Card not found' });
    } catch (error) { return apiError(response, error); }
  }

  const downloadMatch = request.method === 'GET' && url.pathname.match(/^\/api\/cards\/([0-9a-f-]{36})\/download$/i);
  if (downloadMatch) {
    try {
      const sourceId = url.searchParams.get('sourceId') || undefined;
      if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) throw new HttpError(400, 'Invalid sourceId.');
      const source = await repository.getDownloadSource(downloadMatch[1], sourceId);
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

  return json(response, 404, { error: 'Not found' });
});

server.on('error', error => {
  console.error('Public API failed to start:', error);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => console.log(`Public card API listening on ${port}`));

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
  const status = error instanceof HttpError ? error.status : 500;
  console.error('Public API request failed:', error);
  return json(response, status, { error: error instanceof Error ? error.message : String(error) });
}
function setCors(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  const origin = request.headers.origin;
  const allowed = (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-expose-headers', 'content-disposition');
}
function json(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body === null ? '' : JSON.stringify(body));
}
