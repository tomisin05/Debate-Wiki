import type { CardRepository } from './database.js';
import { extractDocuments } from './archive.js';
import { parseDocument } from './parser.js';

export interface IngestionSummary {
  documents: number;
  processedDocuments: number;
  failedDocuments: number;
  cards: number;
  uniqueCards: number;
  duplicateCards: number;
  failures: Array<{ sourcePath: string; error: string }>;
}

export async function ingest(
  bytes: Uint8Array,
  archiveName: string,
  options: { repository?: CardRepository; storageKey?: string; jobId?: string; onProgress?: (message: string) => void } = {},
): Promise<IngestionSummary> {
  const documents = await extractDocuments(bytes, archiveName);
  const summary: IngestionSummary = { documents: documents.length, processedDocuments: 0, failedDocuments: 0, cards: 0, uniqueCards: 0, duplicateCards: 0, failures: [] };
  const dryRunHashes = new Set<string>();
  if (options.jobId && options.repository) await options.repository.beginJob(options.jobId, documents.length);

  for (let index = 0; index < documents.length; index++) {
    const source = documents[index];
    options.onProgress?.(`[${index + 1}/${documents.length}] ${source.sourcePath}`);
    try {
      const parsed = await parseDocument(source);
      summary.cards += parsed.cards.length;
      if (options.repository) {
        const stored = await options.repository.storeDocument(parsed, options.storageKey ?? archiveName);
        summary.uniqueCards += stored.uniqueCards;
        summary.duplicateCards += stored.duplicateCards;
      } else {
        for (const card of parsed.cards) {
          if (dryRunHashes.has(card.contentHash)) summary.duplicateCards++;
          else { dryRunHashes.add(card.contentHash); summary.uniqueCards++; }
        }
      }
      summary.processedDocuments++;
    } catch (error) {
      summary.failedDocuments++;
      summary.failures.push({ sourcePath: source.sourcePath, error: error instanceof Error ? error.message : String(error) });
    }
    if (options.jobId && options.repository) await options.repository.updateJob(options.jobId, {
      processed: summary.processedDocuments,
      unique: summary.uniqueCards,
      duplicate: summary.duplicateCards,
      failed: summary.failedDocuments,
    });
  }
  if (options.jobId && options.repository) await options.repository.finishJob(options.jobId, summary.failedDocuments);
  return summary;
}
