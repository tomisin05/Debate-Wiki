import JSZip from 'jszip';

export interface ArchiveDocument {
  bytes: Uint8Array;
  filename: string;
  sourcePath: string;
  collection: string;
  school: string;
  teamName: string;
}

const MAX_DOCX_FILES = 5000;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

function metadata(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return {
    collection: parts.length > 1 ? parts[0] : '',
    school: parts.length > 2 ? parts[1] : '',
    teamName: parts.length > 3 ? parts[2] : '',
  };
}

function usable(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || '';
  return /\.docx$/i.test(filename) && !filename.startsWith('~$') && !normalized.includes('/__MACOSX/');
}

export async function extractDocuments(input: Uint8Array, archiveName: string): Promise<ArchiveDocument[]> {
  if (/\.docx$/i.test(archiveName)) {
    return [{ bytes: input, filename: archiveName, sourcePath: archiveName, ...metadata(archiveName) }];
  }
  if (!/\.zip$/i.test(archiveName)) throw new Error('Input must be a .zip or .docx file.');

  const zip = await JSZip.loadAsync(input);
  const entries = Object.values(zip.files).filter(entry => !entry.dir && usable(entry.name));
  if (entries.length > MAX_DOCX_FILES) throw new Error(`Archive contains more than ${MAX_DOCX_FILES} Word documents.`);

  const documents: ArchiveDocument[] = [];
  let expandedBytes = 0;
  for (const entry of entries) {
    const bytes = await entry.async('uint8array');
    expandedBytes += bytes.byteLength;
    if (expandedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('Expanded archive exceeds the 2 GB safety limit.');
    documents.push({
      bytes,
      filename: entry.name.replace(/\\/g, '/').split('/').pop()!,
      sourcePath: entry.name,
      ...metadata(entry.name),
    });
  }
  return documents;
}
