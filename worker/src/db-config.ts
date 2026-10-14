export function databaseUrl() {
  const connectionString = process.env.LAYERBASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('LAYERBASE_DATABASE_URL or DATABASE_URL is required.');
  return connectionString;
}
