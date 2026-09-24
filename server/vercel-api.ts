import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SearchSort } from '../worker/src/search.js';

export type ApiRequest = IncomingMessage & { query?: Record<string, string | string[] | undefined> };
export type ApiResponse = ServerResponse;

export function allow(request: ApiRequest, response: ApiResponse, methods: string[]) {
  response.setHeader('allow', methods.join(', '));
  if (request.method && methods.includes(request.method)) return true;
  json(response, 405, { error: 'Method not allowed' });
  return false;
}

export function json(response: ApiResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

export function apiError(response: ApiResponse, error: unknown) {
  console.error('Vercel API request failed:', error);
  const status = error instanceof HttpError ? error.status : 500;
  json(response, status, { error: error instanceof Error ? error.message : String(error) });
}

export function queryValue(request: ApiRequest, name: string) {
  const direct = request.query?.[name];
  if (Array.isArray(direct)) return direct[0];
  if (direct !== undefined) return direct;
  const url = new URL(request.url || '/', 'http://localhost');
  return url.searchParams.get(name) ?? undefined;
}

export function searchInput(request: ApiRequest) {
  const page = integer(queryValue(request, 'page'), 1, 1, 100000);
  const limit = integer(queryValue(request, 'limit'), 25, 1, 100);
  const yearMin = optionalInteger(queryValue(request, 'yearMin'), 1900, 2100);
  const yearMax = optionalInteger(queryValue(request, 'yearMax'), 1900, 2100);
  if (yearMin && yearMax && yearMin > yearMax) throw new HttpError(400, 'yearMin cannot exceed yearMax.');
  const query = limited(queryValue(request, 'q'), 500) ?? '';
  const requestedSort = queryValue(request, 'sort') || (query ? 'relevance' : 'newest');
  const sorts: SearchSort[] = ['relevance', 'year-new', 'year-old', 'newest'];
  if (!sorts.includes(requestedSort as SearchSort)) throw new HttpError(400, 'Invalid sort value.');
  const requestedScope = queryValue(request, 'scope') || 'all';
  if (!['all', 'tag', 'cite', 'body'].includes(requestedScope)) throw new HttpError(400, 'Invalid scope value.');
  return {
    query, page, limit, yearMin, yearMax,
    author: limited(queryValue(request, 'author'), 100),
    collection: limited(queryValue(request, 'collection'), 200),
    school: limited(queryValue(request, 'school'), 200),
    teamName: limited(queryValue(request, 'teamName'), 200),
    sort: requestedSort as SearchSort,
    scope: requestedScope as 'all' | 'tag' | 'cite' | 'body',
  };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, 'Invalid numeric parameter.');
  const result = Number(value);
  if (result < min || result > max) throw new HttpError(400, `Numeric parameter must be between ${min} and ${max}.`);
  return result;
}
function optionalInteger(value: string | undefined, min: number, max: number) {
  return value === undefined || value === '' ? undefined : integer(value, min, min, max);
}
function limited(value: string | undefined, max: number) {
  const result = value?.trim() || undefined;
  if (result && result.length > max) throw new HttpError(400, `Parameter cannot exceed ${max} characters.`);
  return result;
}
