import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { DebateCard, DebateDocument } from '../../src/types.js';
import { extractParagraphsXml, normKey, parseCardsFromDoc } from '../../src/utils/docxProcessor.js';
import type { ArchiveDocument } from './archive.js';

export const PARSER_VERSION = 'cardmirror-compatible-v1';

export interface ParsedDocument extends ArchiveDocument {
  fileHash: string;
  cards: ParsedCard[];
}

export interface ParsedCard extends DebateCard {
  contentHash: string;
  formattedParagraphs: {
    tag: string | null;
    cites: string[];
    undertags: string[];
    body: string[];
  };
}

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

export async function parseDocument(input: ArchiveDocument): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(input.bytes);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('Invalid DOCX file: missing word/document.xml');
  const rawXml = await documentPart.async('string');
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const paragraphsXml = extractParagraphsXml(rawXml);
  const documentId = sha256(input.bytes);
  const doc: DebateDocument = {
    id: documentId,
    filename: input.filename,
    shortName: input.filename.replace(/\.docx$/i, ''),
    zipData: zip,
    rawXml,
    stylesXml,
    paragraphsXml,
    sourcePath: input.sourcePath,
    collection: input.collection,
    school: input.school,
    teamName: input.teamName,
  };

  const cards = parseCardsFromDoc(doc).map(card => ({
    ...card,
    contentHash: sha256(`${normKey(card.tag)}\n${normKey(card.cite)}\n${normKey(card.bodyPlain)}`),
    formattedParagraphs: {
      tag: card.tagParaIndex === null ? null : paragraphsXml[card.tagParaIndex] ?? null,
      cites: (card.citeParaIndices ?? []).map(index => paragraphsXml[index]).filter(Boolean),
      undertags: (card.undertagParaIndices ?? []).map(index => paragraphsXml[index]).filter(Boolean),
      body: card.bodyParaIndices.map(index => paragraphsXml[index]).filter(Boolean),
    },
  }));
  return { ...input, fileHash: documentId, cards };
}
