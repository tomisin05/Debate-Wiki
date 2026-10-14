import 'dotenv/config';
import pg from 'pg';

const names = ['SUPABASE_DATABASE_URL', 'LAYERBASE_DATABASE_URL'];

for (const name of names) {
  const connectionString = process.env[name];
  if (!connectionString) {
    console.log(`${name}: missing`);
    continue;
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });

  try {
    const result = await pool.query(`
      select current_database() as database,
             current_setting('server_version') as version,
             pg_size_pretty(pg_database_size(current_database())) as size
    `);
    console.log(`${name}: connected`, result.rows[0]);
    const tables = await pool.query(`
      select tablename
      from pg_catalog.pg_tables
      where schemaname = 'public'
      order by tablename
    `);
    console.log(`${name}: public tables`, tables.rows.map(row => row.tablename));
    const extensions = await pool.query(`
      select name, default_version, installed_version
      from pg_available_extensions
      where name in ('vector', 'pgcrypto', 'pg_trgm')
      order by name
    `);
    console.log(`${name}: extensions`, extensions.rows);
    for (const table of ['tournaments', 'documents', 'cards', 'card_sources', 'ingestion_jobs']) {
      if (!tables.rows.some(row => row.tablename === table)) continue;
      const count = await pool.query(`select count(*)::bigint as count from public.${table}`);
      console.log(`${name}: ${table} rows`, count.rows[0].count);
    }
    if (tables.rows.some(row => row.tablename === 'cards')) {
      const embeddings = await pool.query('select count(*)::bigint as count from public.cards where embedding is not null');
      console.log(`${name}: non-null card embeddings`, embeddings.rows[0].count);
    }
  } catch (error) {
    console.error(`${name}: connection failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
