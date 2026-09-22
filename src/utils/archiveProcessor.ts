import JSZip from 'jszip';

export interface IngestableDocument {
  file: File;
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

function isUsableDocx(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').pop() || '';
  return /\.docx$/i.test(name) && !name.startsWith('~$') && !normalized.includes('/__MACOSX/');
}

export async function expandUploadFiles(
  uploads: File[],
  onProgress?: (label: string) => void,
): Promise<IngestableDocument[]> {
  const documents: IngestableDocument[] = [];
  let totalBytes = 0;

  for (const upload of uploads) {
    if (/\.docx$/i.test(upload.name)) {
      const meta = metadata(upload.name);
      documents.push({ file: upload, sourcePath: upload.name, ...meta });
      totalBytes += upload.size;
      continue;
    }
    if (!/\.zip$/i.test(upload.name)) continue;

    onProgress?.(`Opening ${upload.name}...`);
    const zip = await JSZip.loadAsync(await upload.arrayBuffer());
    const entries = Object.values(zip.files).filter(entry => !entry.dir && isUsableDocx(entry.name));
    if (documents.length + entries.length > MAX_DOCX_FILES) {
      throw new Error(`Upload contains more than ${MAX_DOCX_FILES.toLocaleString()} Word documents.`);
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      onProgress?.(`Extracting ${index + 1} of ${entries.length}: ${entry.name}`);
      const bytes = await entry.async('uint8array');
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('Expanded upload exceeds the 2 GB safety limit.');
      }
      const filename = entry.name.replace(/\\/g, '/').split('/').pop()!;
      const file = new File([bytes], filename, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      documents.push({ file, sourcePath: entry.name, ...metadata(entry.name) });
    }
  }
  return documents;
}
