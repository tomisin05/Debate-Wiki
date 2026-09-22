import { Pool, PoolClient } from 'pg';
import type { ParsedDocument } from './parser.js';
import { PARSER_VERSION } from './parser.js';

export interface StoredDocumentResult {
  skipped: boolean;
  uniqueCards: number;
  duplicateCards: number;
}

export class CardRepository {
  readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    this.pool = new Pool({ connectionString, max: 5, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
  }

  async close() { await this.pool.end(); }

  async beginJob(jobId: string, totalDocuments: number) {
    await this.pool.query(
      `update public.ingestion_jobs set status='processing', total_documents=$2, started_at=now(), error_message=null where id=$1`,
      [jobId, totalDocuments],
    );
  }

  async updateJob(jobId: string, values: { processed: number; unique: number; duplicate: number; failed: number }) {
    await this.pool.query(
      `update public.ingestion_jobs set processed_documents=$2, unique_cards=$3, duplicate_cards=$4, failed_documents=$5 where id=$1`,
      [jobId, values.processed, values.unique, values.duplicate, values.failed],
    );
  }

  async finishJob(jobId: string, failed: number) {
    await this.pool.query(
      `update public.ingestion_jobs set status=$2, completed_at=now() where id=$1`,
      [jobId, failed ? 'completed_with_warnings' : 'completed'],
    );
  }

  async failJob(jobId: string, error: unknown) {
    await this.pool.query(
      `update public.ingestion_jobs set status='failed', completed_at=now(), error_message=$2 where id=$1`,
      [jobId, error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)],
    );
  }

  async storeDocument(doc: ParsedDocument, storageKey: string): Promise<StoredDocumentResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [doc.fileHash]);
      const existing = await client.query<{ id: string; processing_status: string }>(
        'select id, processing_status from public.documents where file_hash=$1 for update', [doc.fileHash],
      );
      if (existing.rows[0]?.processing_status === 'completed') {
        await client.query('commit');
        return { skipped: true, uniqueCards: 0, duplicateCards: doc.cards.length };
      }

      const documentId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(
        `insert into public.documents
          (file_hash, filename, source_path, storage_key, collection_name, school, team_name, processing_status, parser_version)
         values ($1,$2,$3,$4,$5,$6,$7,'processing',$8) returning id`,
        [doc.fileHash, doc.filename, doc.sourcePath, `${storageKey}#${doc.sourcePath}`, doc.collection, doc.school, doc.teamName, PARSER_VERSION],
      )).rows[0].id;

      if (existing.rows[0]) {
        await client.query(
          `update public.documents set processing_status='processing', error_message=null, parser_version=$2 where id=$1`,
          [documentId, PARSER_VERSION],
        );
      }

      let uniqueCards = 0;
      let duplicateCards = 0;
      for (const card of doc.cards) {
        const insertedCard = await client.query<{ id: string }>(
          `insert into public.cards (content_hash, tag, cite, body_text, author, evidence_year)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (content_hash) do nothing returning id`,
          [card.contentHash, card.tag, card.cite, card.bodyPlain, card.author, card.year],
        );
        const cardId = insertedCard.rows[0]?.id ?? (await client.query<{ id: string }>(
          'select id from public.cards where content_hash=$1', [card.contentHash],
        )).rows[0].id;
        insertedCard.rowCount ? uniqueCards++ : duplicateCards++;

        const source = await client.query(
          `insert into public.card_sources
            (card_id, document_id, section_path, tag_paragraph_index, cite_paragraph_indices, undertag_paragraph_indices, body_paragraph_indices, formatted_paragraphs)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           on conflict (card_id, document_id, tag_paragraph_index) do nothing returning id`,
          [cardId, documentId, card.section, card.tagParaIndex, card.citeParaIndices ?? [], card.undertagParaIndices ?? [], card.bodyParaIndices, JSON.stringify(card.formattedParagraphs)],
        );
        if (source.rowCount) await refreshSourceCount(client, cardId);
      }

      await client.query(
        `update public.documents set processing_status='completed', card_count=$2, duplicate_count=$3, processed_at=now() where id=$1`,
        [documentId, doc.cards.length, duplicateCards],
      );
      await client.query('commit');
      return { skipped: false, uniqueCards, duplicateCards };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function refreshSourceCount(client: PoolClient, cardId: string) {
  await client.query(
    `update public.cards set source_count=(select count(*) from public.card_sources where card_id=$1), updated_at=now() where id=$1`,
    [cardId],
  );
}
