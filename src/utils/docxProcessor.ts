import JSZip from 'jszip';
import { DebateCard, DebateDocument } from '../types';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export const extractYear = (cite: string): number | null => {
  if (!cite) return null;
  
  // 4-digit year
  const fullYear = cite.match(/\b(19[5-9]\d|20[0-9]\d)\b/);
  if (fullYear) return parseInt(fullYear[1]);
  
  // 2-digit shorthand
  const shortYear = cite.match(/[''](\d{2})\b/);
  if (shortYear) {
    const yr = parseInt(shortYear[1]);
    return yr <= 35 ? 2000 + yr : 1900 + yr;
  }
  
  return null;
};

export const extractAuthor = (cite: string): string => {
  const m = cite.match(/^([A-Z][a-zA-Z''\-]+(?:\s+[A-Z][a-zA-Z''\-]+)*(?:\s+et\s+al\.?)?)\s+['']?\d{2}/);
  if (m) return m[1];
  
  const fallback = cite.split(/[,.]/)[0].trim();
  return fallback ? fallback.substring(0, 40) : 'Unknown';
};

export const paragraphText = (p: Element): string => {
  const tNodes = p.getElementsByTagNameNS(NS, 't');
  return Array.from(tNodes).map(n => n.textContent).join('').trim();
};

export const styleVal = (p: Element): string | null => {
  const pPr = p.getElementsByTagNameNS(NS, 'pPr')[0];
  if (!pPr) return null;
  
  const pStyle = pPr.getElementsByTagNameNS(NS, 'pStyle')[0];
  if (!pStyle) return null;
  
  for (const a of pStyle.attributes) {
    if (a.localName === 'val') return a.value;
  }
  return null;
};

export const isHeading = (p: Element, level: number): boolean => {
  const v = styleVal(p);
  return v === `Heading${level}` || v === `heading${level}`;
};

export const isCitation = (p: Element): boolean => {
  const sv = styleVal(p);
  if (sv && /^Heading/i.test(sv)) return false;
  
  const runs = p.getElementsByTagNameNS(NS, 'r');
  return Array.from(runs).some(run => {
    const rPr = run.getElementsByTagNameNS(NS, 'rPr')[0];
    if (!rPr) return false;
    
    const rStyle = rPr.getElementsByTagNameNS(NS, 'rStyle')[0];
    if (rStyle) {
      const val = Array.from(rStyle.attributes).find(a => a.localName === 'val')?.value;
      if (val && /Bold|Strong|13pt|Style13/i.test(val)) return true;
    }
    
    return rPr.getElementsByTagNameNS(NS, 'b').length > 0;
  });
};

export const extractParagraphsXml = (rawXml: string): string[] => {
  const result: string[] = [];
  let pos = 0;
  
  while (pos < rawXml.length) {
    const start = rawXml.indexOf('<w:p', pos);
    if (start === -1) break;
    
    const charAfter = rawXml[start + 4];
    if (charAfter !== ' ' && charAfter !== '>' && charAfter !== '/') {
      pos = start + 4;
      continue;
    }
    
    const tagEnd = rawXml.indexOf('>', start);
    if (tagEnd === -1) break;
    
    if (rawXml[tagEnd - 1] === '/') {
      result.push(rawXml.slice(start, tagEnd + 1));
      pos = tagEnd + 1;
    } else {
      const closeTag = '</w:p>';
      const close = rawXml.indexOf(closeTag, tagEnd);
      if (close === -1) break;
      result.push(rawXml.slice(start, close + closeTag.length));
      pos = close + closeTag.length;
    }
  }
  
  return result;
};

export const stripTagsToText = (xml: string): string => {
  if (!xml) return '';
  
  const out: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^]*?)<\/w:t>/g;
  let m;
  
  while ((m = re.exec(xml)) !== null) {
    out.push(decodeXmlEntities(m[1]));
  }
  
  return out.join('');
};

export const decodeXmlEntities = (str: string): string => {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
};

export const escapeHtml = (s: string): string => {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

export const normKey = (s: string): string => {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
};

export const processDocxFile = async (file: File): Promise<DebateDocument> => {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXmlFile = zip.file('word/document.xml');
  
  if (!docXmlFile) {
    throw new Error('Invalid DOCX file: missing document.xml');
  }
  
  const rawXml = await docXmlFile.async('string');
  
  return {
    id: Date.now().toString(),
    filename: file.name,
    shortName: file.name.replace(/\.docx$/i, ''),
    zipData: zip,
    rawXml,
    paragraphsXml: extractParagraphsXml(rawXml),
  };
};

interface CardState {
  section: string;
  tag: string | null;
  cite: string | null;
  tagParaIndex: number | null;
  citeParaIndex: number | null;
  bodyParaIndices: number[];
  inCard: boolean;
}

export const parseCardsFromDoc = (doc: DebateDocument): DebateCard[] => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(doc.rawXml, 'text/xml');
  const paragraphs = Array.from(xml.getElementsByTagNameNS(NS, 'p'));
  
  let currentSection = '';
  let cardState: CardState = newCardState();
  const cards: DebateCard[] = [];
  let nextCardId = 1;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const text = paragraphText(p);

    if (isHeading(p, 1) || isHeading(p, 2) || isHeading(p, 3)) {
      finalizeCard(doc, cardState, cards, nextCardId++);
      cardState = newCardState();
      if (text) currentSection = text;
      continue;
    }

    if (isHeading(p, 4) && text.length > 4) {
      finalizeCard(doc, cardState, cards, nextCardId++);
      cardState = newCardState();
      cardState.section = currentSection;
      cardState.tag = text;
      cardState.tagParaIndex = i;
      
      const next = paragraphs[i + 1];
      if (next && isCitation(next)) {
        cardState.cite = paragraphText(next);
        cardState.citeParaIndex = i + 1;
        i++;
      }
      cardState.inCard = true;
      continue;
    }

    if (cardState.inCard) {
      const hasContent = text || p.getElementsByTagNameNS(NS, 'r').length > 0;
      if (hasContent) cardState.bodyParaIndices.push(i);
    }
  }
  
  finalizeCard(doc, cardState, cards, nextCardId++);
  return cards;
};

const newCardState = (): CardState => ({
  section: '',
  tag: null,
  cite: null,
  tagParaIndex: null,
  citeParaIndex: null,
  bodyParaIndices: [],
  inCard: false,
});

const finalizeCard = (
  doc: DebateDocument, 
  s: CardState, 
  cards: DebateCard[], 
  cardId: number
): void => {
  if (!s.tag) return;
  
  const bodyPlain = s.bodyParaIndices
    .map(idx => stripTagsToText(doc.paragraphsXml[idx]))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const year = extractYear(s.cite || '');
  const dupKey = normKey(s.tag) + '|||' + normKey(s.cite || '');

  const card: DebateCard = {
    id: `${doc.id}-${cardId}`,
    docId: doc.id,
    docName: doc.shortName,
    section: s.section || '',
    tag: s.tag,
    cite: s.cite || '',
    tagParaIndex: s.tagParaIndex,
    citeParaIndex: s.citeParaIndex,
    bodyParaIndices: [...s.bodyParaIndices],
    bodyPlain,
    year,
    dupKey,
    searchTag: s.tag.toLowerCase(),
    searchCite: (s.cite || '').toLowerCase(),
    searchBody: bodyPlain.toLowerCase(),
    searchAll: (s.tag + ' ' + (s.cite || '') + ' ' + bodyPlain).toLowerCase(),
    snippetHtml: escapeHtml(bodyPlain.substring(0, 200)),
    author: extractAuthor(s.cite || ''),
  };
  
  cards.push(card);
};