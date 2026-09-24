import { buildStoredCardDocx } from '../../../worker/src/download.js';
import { SearchRepository } from '../../../worker/src/search.js';
import { allow, apiError, HttpError, json, queryValue, type ApiRequest, type ApiResponse } from '../../../server/vercel-api.js';

const repository = new SearchRepository();

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!allow(request, response, ['GET'])) return;
  try {
    const id = queryValue(request, 'id');
    const sourceId = queryValue(request, 'sourceId');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Invalid card id.');
    if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) throw new HttpError(400, 'Invalid sourceId.');
    const source = await repository.getDownloadSource(id, sourceId);
    if (!source) return json(response, 404, { error: 'Card source not found' });
    const file = await buildStoredCardDocx(source);
    response.statusCode = 200;
    response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    response.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('content-length', String(file.bytes.byteLength));
    response.setHeader('cache-control', 'private, no-store');
    response.end(Buffer.from(file.bytes));
  } catch (error) { apiError(response, error); }
}
