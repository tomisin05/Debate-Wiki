import 'dotenv/config';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query(`
    select
      (select count(*)::int from public.documents) as documents,
      (select count(*)::int from public.cards) as cards,
      (select count(*)::int from public.card_sources) as sources,
      (select count(*)::int from public.documents where processing_status = 'completed') as completed_documents,
      (select count(*)::int from public.documents where processing_status = 'failed') as failed_documents
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await client.end();
}
