import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { CardRepository } from './database.js';
import { ingest } from './ingest.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const input = args.find(arg => !arg.startsWith('--'));
if (!input) throw new Error('Usage: npm run ingest:dry -- <archive.zip> or npm run ingest -- <archive.zip>');

const path = resolve(input);
const repository = dryRun ? undefined : new CardRepository();
try {
  const summary = await ingest(new Uint8Array(await readFile(path)), basename(path), {
    repository,
    storageKey: path,
    onProgress: message => console.log(message),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failedDocuments) process.exitCode = 1;
} finally {
  await repository?.close();
}
