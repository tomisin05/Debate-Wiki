import JSZip from 'jszip';
import { ApiCard } from '../api/cards';

const xml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const paragraph = (text: string, options: { bold?: boolean; size?: number; pageBreakBefore?: boolean } = {}) => {
  const paragraphProperties = options.pageBreakBefore ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : '';
  const runProperties = options.bold || options.size
    ? `<w:rPr>${options.bold ? '<w:b/>' : ''}${options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : ''}</w:rPr>`
    : '';
  return `<w:p>${paragraphProperties}<w:r>${runProperties}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
};

function sourceLabel(card: ApiCard) {
  const source = card.source ?? card.sources?.[0];
  if (!source) return '';
  return [source.school, source.teamName, source.filename].filter(Boolean).join(' — ');
}

function addPageBreakBefore(paragraphXml: string) {
  if (!paragraphXml) return paragraphXml;
  if (/<w:pPr\b[^>]*>/.test(paragraphXml)) {
    return paragraphXml.replace(/<w:pPr\b([^>]*)>/, '<w:pPr$1><w:pageBreakBefore/>');
  }
  return paragraphXml.replace(/<w:p\b([^>]*)>/, '<w:p$1><w:pPr><w:pageBreakBefore/></w:pPr>');
}

function formattedCard(card: ApiCard, index: number) {
  const source = card.source ?? card.sources?.[0];
  const formatted = source?.formattedParagraphs;
  const originalParagraphs = formatted
    ? [formatted.tag, ...formatted.cites, ...formatted.undertags, ...formatted.body].filter((value): value is string => Boolean(value))
    : [];

  if (originalParagraphs.length) {
    if (index > 0) originalParagraphs[0] = addPageBreakBefore(originalParagraphs[0]);
    return originalParagraphs.join('');
  }

  const meta = [card.author, card.year, sourceLabel(card)].filter(value => value !== null && value !== undefined && value !== '').join(' • ');
  return [
    paragraph(card.tag || 'Untitled card', { bold: true, size: 28, pageBreakBefore: index > 0 }),
    ...(meta ? [paragraph(meta, { size: 18 })] : []),
    paragraph(card.cite || '', { bold: true, size: 20 }),
    ...String(card.body || '').split(/\r?\n/).map(line => paragraph(line, { size: 20 })),
  ].join('');
}

export async function downloadCardsDocx(cards: ApiCard[], filename = 'filtered-debate-cards.docx') {
  const zip = new JSZip();
  const now = new Date().toISOString();
  const content = cards.map(formattedCard).join('');

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style><w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/><w:iCs/></w:rPr></w:style><w:style w:type="character" w:styleId="Style13ptBold"><w:name w:val="13 pt Bold"/><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style></w:styles>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Filtered Debate Cards</dc:title><dc:creator>Debate Wiki</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Debate Wiki</Application></Properties>');

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
