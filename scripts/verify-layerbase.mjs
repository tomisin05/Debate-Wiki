import 'dotenv/config';
import pg from 'pg';

if (!process.env.LAYERBASE_DATABASE_URL) throw new Error('LAYERBASE_DATABASE_URL is required.');

const pool = new pg.Pool({
  connectionString: process.env.LAYERBASE_DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

try {
  const counts = await pool.query(`
    select
      (select count(*)::int from public.documents) documents,
      (select count(*)::int from public.cards) cards,
      (select count(*)::int from public.card_sources) sources,
      (select count(*)::int from public.ingestion_jobs) ingestion_jobs,
      pg_size_pretty(pg_database_size(current_database())) database_size
  `);
  const search = await pool.query(`
    select c.id, c.tag, ts_rank_cd(c.search_vector, q.value, 32) score
    from public.cards c
    cross join (select websearch_to_tsquery('english', 'climate') value) q
    where c.search_vector @@ q.value
    order by score desc, c.id
    limit 5
  `);
  const filters = await pool.query(`
    select
      count(distinct collection_name)::int collections,
      count(distinct school)::int schools,
      count(distinct team_name)::int teams
    from public.documents
  `);
  if (!search.rowCount) throw new Error('Representative full-text search returned no results.');
  console.log(JSON.stringify({ ...counts.rows[0], search_results: search.rowCount, ...filters.rows[0] }, null, 2));
} finally {
  await pool.end();
}
