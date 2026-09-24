import { SearchRepository } from '../worker/src/search.js';
import { allow, apiError, json, searchInput, type ApiRequest, type ApiResponse } from '../server/vercel-api.js';

const repository = new SearchRepository();

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!allow(request, response, ['GET'])) return;
  try { json(response, 200, await repository.search(searchInput(request))); }
  catch (error) { apiError(response, error); }
}
