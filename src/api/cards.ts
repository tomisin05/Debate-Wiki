import { DebateCard, DebateDocument } from '../types';
import { escapeHtml, normKey } from '../utils/docxProcessor';
import { auth } from '../firebase';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');

export interface ApiSource {
  sourceId: string;
  documentId: string;
  filename: string;
  sourcePath: string;
  collection: string;
  school: string;
  teamName: string;
  section: string;
  tagParagraphIndex: number | null;
  citeParagraphIndices: number[];
  undertagParagraphIndices: number[];
  bodyParagraphIndices: number[];
  formattedParagraphs: { tag: string | null; cites: string[]; undertags: string[]; body: string[] };
}

export interface ApiCard {
  id: string;
  tag: string;
  cite: string;
  body: string;
  author: string;
  year: number | null;
  sourceCount: number;
  score?: number;
  source?: ApiSource | null;
  sources?: ApiSource[];
}

export interface SearchResponse { items: ApiCard[]; page: number; limit: number; total: number; totalPages: number }
export interface FilterResponse { collections: string[]; schools: string[]; teams: string[]; documents: number; cards: number }
export interface IngestionJob {
  id: string; archiveName: string; status: 'queued' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed';
  totalDocuments: number; processedDocuments: number; uniqueCards: number; duplicateCards: number;
  failedDocuments: number; errorMessage: string | null;
}

export async function searchCards(params: URLSearchParams, signal?: AbortSignal): Promise<SearchResponse> {
  return request(`/api/cards?${params}`, signal);
}
export async function getCard(id: string, signal?: AbortSignal): Promise<ApiCard> { return request(`/api/cards/${id}`, signal); }
export async function getFilters(signal?: AbortSignal): Promise<FilterResponse> { return request('/api/filters', signal); }
export async function downloadCardDocx(cardId: string, sourceId?: string) {
  const params = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : '';
  const response = await fetch(`${API_URL}/api/cards/${cardId}/download${params}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Download API returned ${response.status}.`);
  }
  const disposition = response.headers.get('content-disposition') || '';
  return { blob: await response.blob(), filename: disposition.match(/filename="([^"]+)"/)?.[1] || 'debate-card.docx' };
}

export async function uploadArchive(file: File, onProgress: (percent: number, label: string) => void): Promise<IngestionJob> {
  const token = await adminToken();
  onProgress(0, `Preparing ${file.name}...`);
  const prepared = await adminRequest<{ jobId: string; uploadUrl: string }>('/api/admin/uploads/presign', token, {
    method: 'POST', body: JSON.stringify({ archiveName: file.name, size: file.size, contentType: file.type || 'application/zip' }),
  });
  await putFile(prepared.uploadUrl, file, percent => onProgress(percent * 0.8, `Uploading ${file.name}: ${Math.round(percent)}%`));
  onProgress(82, `Starting ingestion for ${file.name}...`);
  await adminRequest(`/api/admin/uploads/${prepared.jobId}/complete`, token, { method: 'POST' });

  for (;;) {
    const job = await adminRequest<IngestionJob>(`/api/admin/jobs/${prepared.jobId}`, token);
    const ingestionPercent = job.totalDocuments ? job.processedDocuments / job.totalDocuments : 0;
    onProgress(82 + ingestionPercent * 18, `${job.status}: ${job.processedDocuments} of ${job.totalDocuments || '?'} documents`);
    if (['completed', 'completed_with_warnings'].includes(job.status)) return job;
    if (job.status === 'failed') throw new Error(job.errorMessage || 'Archive ingestion failed.');
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Search API returned ${response.status}.`);
  }
  return response.json();
}

async function adminToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before uploading tournament archives.');
  return user.getIdToken();
}

async function adminRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Upload API returned ${response.status}.`);
  return body;
}

function putFile(url: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type || 'application/zip');
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total * 100); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 upload returned ${xhr.status}.`));
    xhr.onerror = () => reject(new Error('The archive could not be uploaded to R2.'));
    xhr.send(file);
  });
}

export function materializeCard(apiCard: ApiCard, source = apiCard.source ?? apiCard.sources?.[0]): { card: DebateCard; doc: DebateDocument } | null {
  if (!source) return null;
  const previewDocumentId = `${source.documentId}:${apiCard.id}`;
  const indices = [source.tagParagraphIndex ?? -1, ...source.citeParagraphIndices, ...source.undertagParagraphIndices, ...source.bodyParagraphIndices];
  const paragraphsXml = Array.from({ length: Math.max(0, ...indices) + 1 }, () => '');
  if (source.tagParagraphIndex !== null && source.formattedParagraphs.tag) paragraphsXml[source.tagParagraphIndex] = source.formattedParagraphs.tag;
  source.citeParagraphIndices.forEach((index, offset) => { paragraphsXml[index] = source.formattedParagraphs.cites[offset] || ''; });
  source.undertagParagraphIndices.forEach((index, offset) => { paragraphsXml[index] = source.formattedParagraphs.undertags[offset] || ''; });
  source.bodyParagraphIndices.forEach((index, offset) => { paragraphsXml[index] = source.formattedParagraphs.body[offset] || ''; });

  const doc: DebateDocument = {
    id: previewDocumentId, filename: source.filename, shortName: source.filename.replace(/\.docx$/i, ''),
    zipData: null, rawXml: '', paragraphsXml, sourcePath: source.sourcePath,
    collection: source.collection, school: source.school, teamName: source.teamName, remote: true,
  };
  const card: DebateCard = {
    id: apiCard.id, docId: previewDocumentId, docName: doc.shortName, section: source.section || '',
    tag: apiCard.tag, cite: apiCard.cite, tagParaIndex: source.tagParagraphIndex,
    citeParaIndex: source.citeParagraphIndices[0] ?? null, citeParaIndices: source.citeParagraphIndices,
    undertagParaIndices: source.undertagParagraphIndices, bodyParaIndices: source.bodyParagraphIndices,
    bodyPlain: apiCard.body, year: apiCard.year, author: apiCard.author,
    dupKey: `${normKey(apiCard.tag)}|||${normKey(apiCard.cite)}`,
    searchTag: apiCard.tag.toLowerCase(), searchCite: apiCard.cite.toLowerCase(),
    searchBody: apiCard.body.toLowerCase(), searchAll: `${apiCard.tag} ${apiCard.cite} ${apiCard.body}`.toLowerCase(),
    snippetHtml: escapeHtml(apiCard.body.substring(0, 200)), searchScore: apiCard.score ? apiCard.score * 100 : undefined,
    sourceId: source.sourceId,
  };
  return { card, doc };
}
