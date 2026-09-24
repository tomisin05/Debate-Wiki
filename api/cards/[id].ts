import { SearchRepository } from '../../worker/src/search.js';
import { allow, apiError, HttpError, json, queryValue, type ApiRequest, type ApiResponse } from '../../server/vercel-api.js';

const repository = new SearchRepository();

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!allow(request, response, ['GET'])) return;
  try {
    const id = queryValue(request, 'id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Invalid card id.');
    const card = await repository.getCard(id);
    json(response, card ? 200 : 404, card ?? { error: 'Card not found' });
  } catch (error) { apiError(response, error); }
}
