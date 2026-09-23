import JSZip from 'jszip';
import { extractParagraphsXml } from '../../src/utils/docxProcessor.js';
import { R2Storage } from './storage.js';

interface DownloadSource {
  tag: string;
  author: string;
  filename: string;
  storage_key: string;
  source_path: string;
  tag_paragraph_index: number | null;
  cite_paragraph_indices: number[];
  undertag_paragraph_indices: number[];
  body_paragraph_indices: number[];
}

export async function buildStoredCardDocx(source: DownloadSource, storage = new R2Storage()) {
  const separator = source.storage_key.indexOf('#');
  const objectKey = separator === -1 ? source.storage_key : source.storage_key.slice(0, separator);
  const sourcePath = separator === -1 ? source.source_path : source.storage_key.slice(separator + 1);
  if (!objectKey || /^[A-Za-z]:\\/.test(objectKey)) throw new Error('This source document has not been linked to R2 storage.');

  const storedBytes = await storage.download(objectKey);
  let docxBytes = storedBytes;
  if (/\.zip$/i.test(objectKey)) {
    const archive = await JSZip.loadAsync(storedBytes);
    const entry = archive.file(sourcePath) || Object.values(archive.files).find(file => !file.dir && file.name.replace(/\\/g, '/') === sourcePath.replace(/\\/g, '/'));
    if (!entry) throw new Error(`Source document ${sourcePath} was not found in the archive.`);
    docxBytes = await entry.async('uint8array');
  }

  const docx = await JSZip.loadAsync(docxBytes);
  const documentPart = docx.file('word/document.xml');
  if (!documentPart) throw new Error('Source DOCX is missing word/document.xml.');
  const rawXml = await documentPart.async('string');
  const paragraphs = extractParagraphsXml(rawXml);
  const keep = new Set<number>();
  if (source.tag_paragraph_index !== null) keep.add(source.tag_paragraph_index);
  source.cite_paragraph_indices.forEach(index => keep.add(index));
  source.undertag_paragraph_indices.forEach(index => keep.add(index));
  source.body_paragraph_indices.forEach(index => keep.add(index));
  const selected = paragraphs.map((xml, index) => keep.has(index) ? xml : '').join('');
  const sectionProperties = rawXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? '';
  const newXml = rawXml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, body => {
    const opening = body.match(/^<w:body\b[^>]*>/)?.[0];
    if (!opening) throw new Error('Source DOCX has an invalid document body.');
    return `${opening}${selected}${sectionProperties}</w:body>`;
  });
  docx.file('word/document.xml', newXml);
  const bytes = await docx.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, filename: safeFilename(source) };
}

function safeFilename(source: DownloadSource) {
  const clean = (value: string) => (value || '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 40);
  return `${clean(source.filename.replace(/\.docx$/i, '')).slice(0, 20)}__${clean(source.author)}_${clean(source.tag).slice(0, 30)}.docx`;
}
