import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export interface IngestionJob {
  id: string;
  archiveName: string;
  storageKey: string;
  status: string;
  totalDocuments: number;
  processedDocuments: number;
  uniqueCards: number;
  duplicateCards: number;
  failedDocuments: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class UploadRepository {
  readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    this.pool = new Pool({ connectionString, max: 5, ssl: { rejectUnauthorized: false } });
  }

  async createJob(archiveName: string, storageKey: string, uploadedBy: string) {
    const result = await this.pool.query<{ id: string }>(
      `insert into public.ingestion_jobs (id, archive_name, storage_key, uploaded_by)
       values ($1,$2,$3,$4) returning id`,
      [randomUUID(), archiveName, storageKey, uploadedBy],
    );
    return result.rows[0].id;
  }

  async getJob(id: string) {
    const result = await this.pool.query(`select * from public.ingestion_jobs where id=$1`, [id]);
    return result.rows[0] ? toJob(result.rows[0]) : null;
  }

  async listJobs(limit = 30) {
    const result = await this.pool.query(`select * from public.ingestion_jobs order by created_at desc limit $1`, [limit]);
    return result.rows.map(toJob);
  }
}

function toJob(row: any): IngestionJob {
  return {
    id: row.id, archiveName: row.archive_name, storageKey: row.storage_key, status: row.status,
    totalDocuments: row.total_documents, processedDocuments: row.processed_documents,
    uniqueCards: row.unique_cards, duplicateCards: row.duplicate_cards,
    failedDocuments: row.failed_documents, errorMessage: row.error_message,
    createdAt: row.created_at, completedAt: row.completed_at,
  };
}
