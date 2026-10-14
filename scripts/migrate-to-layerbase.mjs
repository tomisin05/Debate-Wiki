import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const sourceUrl = process.env.SUPABASE_DATABASE_URL;
const targetUrl = process.env.LAYERBASE_DATABASE_URL;
if (!sourceUrl || !targetUrl) throw new Error('SUPABASE_DATABASE_URL and LAYERBASE_DATABASE_URL are required.');

const source = new pg.Pool({ connectionString: sourceUrl, max: 2, ssl: { rejectUnauthorized: false } });
const target = new pg.Pool({ connectionString: targetUrl, max: 2, ssl: { rejectUnauthorized: false } });

const tables = [
  { name: 'tournaments', columns: ['id', 'slug', 'name', 'season', 'starts_on', 'created_at'] },
  { name: 'documents', columns: ['id', 'file_hash', 'filename', 'source_path', 'storage_key', 'collection_name', 'school', 'team_name', 'tournament_id', 'uploaded_by', 'processing_status', 'parser_version', 'card_count', 'duplicate_count', 'error_message', 'created_at', 'processed_at'] },
  { name: 'cards', columns: ['id', 'content_hash', 'tag', 'cite', 'body_text', 'author', 'evidence_year', 'source_count', 'created_at', 'updated_at'] },
  { name: 'card_sources', columns: ['id', 'card_id', 'document_id', 'section_path', 'tag_paragraph_index', 'cite_paragraph_indices', 'undertag_paragraph_indices', 'body_paragraph_indices', 'formatted_paragraphs', 'generated_docx_key', 'created_at'] },
  { name: 'ingestion_jobs', columns: ['id', 'archive_name', 'storage_key', 'status', 'total_documents', 'processed_documents', 'unique_cards', 'duplicate_cards', 'failed_documents', 'uploaded_by', 'error_message', 'created_at', 'started_at', 'completed_at'] },
];

async function assertTargetEmpty() {
  const result = await target.query(`
    select tablename from pg_catalog.pg_tables
    where schemaname = 'public' and tablename = any($1::text[])
  `, [tables.map(table => table.name)]);
  if (result.rowCount) throw new Error(`Layerbase target is not empty; found: ${result.rows.map(row => row.tablename).join(', ')}`);
}

async function copyTable({ name, columns }) {
  const batchSize = 100;
  let copied = 0;
  while (true) {
    const result = await source.query(
      `select ${columns.join(', ')} from public.${name} order by id limit $1 offset $2`,
      [batchSize, copied],
    );
    if (!result.rowCount) break;

    const values = [];
    const tuples = result.rows.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        let value = row[column];
        if (column === 'formatted_paragraphs' && value !== null && typeof value !== 'string') value = JSON.stringify(value);
        values.push(value);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(',')})`;
    });
    await target.query(
      `insert into public.${name} (${columns.join(',')}) values ${tuples.join(',')}`,
      values,
    );
    copied += result.rowCount;
    if (copied % 1000 === 0 || result.rowCount < batchSize) console.log(`${name}: ${copied} rows copied`);
  }
  return copied;
}

try {
  await assertTargetEmpty();
  const schema = await readFile(new URL('../layerbase/migrations/202610140001_initial_card_library.sql', import.meta.url), 'utf8');
  await target.query(schema);
  const expected = new Map();
  for (const table of tables) {
    const count = await source.query(`select count(*)::integer as count from public.${table.name}`);
    expected.set(table.name, count.rows[0].count);
    await copyTable(table);
  }
  for (const table of tables) {
    const actual = await target.query(`select count(*)::integer as count from public.${table.name}`);
    if (actual.rows[0].count !== expected.get(table.name)) {
      throw new Error(`${table.name}: expected ${expected.get(table.name)} rows, found ${actual.rows[0].count}`);
    }
  }
  console.log('Migration complete; all table row counts match.');
} finally {
  await Promise.allSettled([source.end(), target.end()]);
}
