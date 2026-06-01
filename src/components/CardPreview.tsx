import React, { useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { DebateCard, DebateDocument } from '../types';
import { escapeHtml, stripTagsToText, decodeXmlEntities } from '../utils/docxProcessor';

declare global {
  interface Window {
    docx?: { renderAsync: Function };
    docxPreview?: { renderAsync: Function };
  }
}

interface CardPreviewProps {
  card: DebateCard | null;
  docs: Map<string, DebateDocument>;
  onStepSelection: (direction: number) => void;
  showToast: (message: string) => void;
}

async function buildCardDocx(card: DebateCard, doc: DebateDocument, bodyOnly = false): Promise<Blob> {
  const newZip = new JSZip();
  for (const [path, entry] of Object.entries(doc.zipData.files) as any) {
    if (path === 'word/document.xml') continue;
    if (entry.dir) continue;
    newZip.file(path, await entry.async('uint8array'));
  }
  newZip.file('word/document.xml', buildCardXml(card, doc, bodyOnly));
  return newZip.generateAsync({ type: 'blob' });
}

function buildCardXml(card: DebateCard, doc: DebateDocument, bodyOnly = false): string {
  const keep = new Set<number>();
  if (!bodyOnly) {
    if (card.tagParaIndex !== null) keep.add(card.tagParaIndex);
    if (card.citeParaIndex !== null) keep.add(card.citeParaIndex);
  }
  card.bodyParaIndices.forEach(i => keep.add(i));
  const bodyParas = doc.paragraphsXml
    .map((xml, i) => keep.has(i) ? xml : null)
    .filter(Boolean).join('');
  const sectPrMatch = doc.rawXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '';
  return doc.rawXml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, match => {
    const open = match.match(/^<w:body\b[^>]*>/)![0];
    return `${open}${bodyParas}${sectPr}</w:body>`;
  });
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFilename(card: DebateCard, doc: DebateDocument): string {
  const clean = (s: string) => (s || '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').substring(0, 40);
  return `${clean(doc.shortName).substring(0, 20)}__${clean(card.author)}_${clean(card.tag).substring(0, 30)}.docx`;
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const HL_MAP: Record<string, string> = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF',
  red: '#FF0000', blue: '#0000FF', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0',
  black: '#000000', white: '#FFFFFF',
};

function attr(el: Element, localName: string): string | undefined {
  return Array.from(el.attributes).find(a => a.localName === localName)?.value;
}

const XML_NS_WRAPPER = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">`;

function xmlParaToHtml(paraXml: string): string {
  if (!paraXml) return '';
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(`${XML_NS_WRAPPER}${paraXml}</w:document>`, 'text/xml');
  const p = xmlDoc.getElementsByTagNameNS(NS_W, 'p')[0];
  if (!p) return '';

  const runs = p.getElementsByTagNameNS(NS_W, 'r');
  if (!runs.length) return '<p style="margin:0 0 4px 0;"></p>';

  let html = '';
  for (const run of Array.from(runs)) {
    const rPr = run.getElementsByTagNameNS(NS_W, 'rPr')[0];
    const text = Array.from(run.getElementsByTagNameNS(NS_W, 't')).map(t => t.textContent).join('');
    if (!text) continue;

    const styles: string[] = [];
    let isBold = false, isUnderline = false;

    if (rPr) {
      if (rPr.getElementsByTagNameNS(NS_W, 'b').length) isBold = true;

      const uEl = rPr.getElementsByTagNameNS(NS_W, 'u')[0];
      if (uEl && attr(uEl, 'val') !== 'none') isUnderline = true;

      if (rPr.getElementsByTagNameNS(NS_W, 'i').length) styles.push('font-style:italic');

      const szEl = rPr.getElementsByTagNameNS(NS_W, 'sz')[0];
      if (szEl) {
        const hp = parseInt(attr(szEl, 'val') || '0');
        if (hp > 0) styles.push(`font-size:${hp / 2}pt`);
      }

      const fontsEl = rPr.getElementsByTagNameNS(NS_W, 'rFonts')[0];
      if (fontsEl) {
        const ff = attr(fontsEl, 'ascii') || attr(fontsEl, 'hAnsi');
        if (ff) styles.push(`font-family:${ff},sans-serif`);
      }

      const colorEl = rPr.getElementsByTagNameNS(NS_W, 'color')[0];
      if (colorEl) {
        const cv = attr(colorEl, 'val');
        if (cv && cv !== 'auto') styles.push(`color:#${cv}`);
      }

      const hlEl = rPr.getElementsByTagNameNS(NS_W, 'highlight')[0];
      if (hlEl) {
        const hv = attr(hlEl, 'val');
        if (hv && HL_MAP[hv]) styles.push(`background-color:${HL_MAP[hv]}`);
      } else {
        const shdEl = rPr.getElementsByTagNameNS(NS_W, 'shd')[0];
        if (shdEl) {
          const fill = attr(shdEl, 'fill');
          if (fill && fill !== 'auto' && fill !== 'FFFFFF') styles.push(`background-color:#${fill}`);
        }
      }

      const bdrEl = rPr.getElementsByTagNameNS(NS_W, 'bdr')[0];
      if (bdrEl && attr(bdrEl, 'val') !== 'none') styles.push('border:1px solid #000;padding:0 1px');

      const rStyleEl = rPr.getElementsByTagNameNS(NS_W, 'rStyle')[0];
      if (rStyleEl) {
        const sv = attr(rStyleEl, 'val') || '';
        if (/^Emphasis$/i.test(sv)) { isBold = true; isUnderline = true; styles.push('border:1px solid #000;padding:0 1px'); }
        else if (/^StyleUnderline$/i.test(sv)) isUnderline = true;
        else if (/underline/i.test(sv)) isUnderline = true;
        else if (/bold/i.test(sv)) { isBold = true; isUnderline = true; }
        if (/13pt|Style13/i.test(sv)) { isBold = true; if (!styles.some(s => s.startsWith('font-size'))) styles.push('font-size:10pt'); }
      }
    }

    if (isBold) styles.push('font-weight:bold');
    if (isUnderline) styles.push('text-decoration:underline');

    const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
    html += `<span${styleAttr}>${escapeHtml(decodeXmlEntities(text))}</span>`;
  }

  return `<p style="margin:0 0 4px 0;">${html}</p>`;
}

async function writeClipboard(plainText: string, html: string | null) {
  try {
    if (html && (window as any).ClipboardItem && navigator.clipboard?.write) {
      const item = new (window as any).ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      return;
    }
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(plainText); return; }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = plainText;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

const CardPreview: React.FC<CardPreviewProps> = ({ card, docs, onStepSelection, showToast }) => {
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);
  const currentBlobRef = useRef<Blob | null>(null);

  const renderPreview = useCallback(async (c: DebateCard | null) => {
    const token = ++renderTokenRef.current;
    const bodyEl = previewBodyRef.current;
    if (!bodyEl) return;

    if (!c) {
      bodyEl.innerHTML = `<div class="preview-placeholder"><span class="big">←</span>Select a card from the list to view it here.</div>`;
      currentBlobRef.current = null;
      return;
    }

    const doc = docs.get(c.docId);
    if (!doc) {
      bodyEl.innerHTML = `<div class="preview-placeholder">Source document is no longer available.</div>`;
      return;
    }

    bodyEl.innerHTML = `<div class="preview-loading"><div class="spinner"></div>Rendering card...</div>`;

    let blob: Blob;
    try { blob = await buildCardDocx(c, doc); } catch (err) {
      if (token !== renderTokenRef.current) return;
      bodyEl.innerHTML = `<div class="preview-placeholder">Error building preview: ${escapeHtml(String(err))}</div>`;
      return;
    }
    if (token !== renderTokenRef.current) return;
    currentBlobRef.current = blob;

    const docxLib = window.docx || window.docxPreview;
    if (docxLib?.renderAsync) {
      try {
        const bodyBlob = await buildCardDocx(c, doc, true);
        const arrayBuffer = await bodyBlob.arrayBuffer();
        if (token !== renderTokenRef.current) return;

        const headerEl = document.createElement('div');
        headerEl.className = 'card-header-block';
        if (c.section) { const el = document.createElement('div'); el.className = 'ch-section'; el.textContent = c.section; headerEl.appendChild(el); }
        const tagEl = document.createElement('div'); tagEl.className = 'ch-tag';
        if (c.tagParaIndex !== null) { tagEl.innerHTML = xmlParaToHtml(doc.paragraphsXml[c.tagParaIndex]); }
        else { tagEl.textContent = c.tag; }
        headerEl.appendChild(tagEl);
        if (c.cite) {
          const el = document.createElement('div'); el.className = 'ch-cite';
          if (c.citeParaIndex !== null) { el.innerHTML = xmlParaToHtml(doc.paragraphsXml[c.citeParaIndex]); }
          else { el.textContent = c.cite; }
          headerEl.appendChild(el);
        }
        if (c.year) { const el = document.createElement('div'); el.className = 'ch-year'; el.textContent = String(c.year); headerEl.appendChild(el); }
        const divider = document.createElement('div'); divider.className = 'ch-divider'; headerEl.appendChild(divider);

        bodyEl.innerHTML = '';
        bodyEl.appendChild(headerEl);
        const bodyContainer = document.createElement('div');
        bodyEl.appendChild(bodyContainer);

        await docxLib.renderAsync(arrayBuffer, bodyContainer, null, {
          className: 'docx', inWrapper: true, ignoreWidth: true, ignoreHeight: true,
          breakPages: false, useBase64URL: true,
          renderHeaders: false, renderFooters: false, renderFootnotes: false, renderEndnotes: false,
        });
        if (token !== renderTokenRef.current) return;
        bodyEl.scrollTop = 0;
        return;
      } catch (err) {
        console.warn('docx-preview failed, falling back:', err);
        if (token !== renderTokenRef.current) return;
      }
    }

    // Fallback plain render
    const doc2 = docs.get(c.docId)!;
    const parts: string[] = [];
    if (c.section) parts.push(`<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:var(--color-text-tertiary);margin-bottom:8px;">${escapeHtml(c.section)}</div>`);
    parts.push(`<div style="font-size:16px;font-weight:700;margin-bottom:8px;">${escapeHtml(c.tag)}</div>`);
    if (c.cite) parts.push(`<div style="font-size:12px;font-weight:600;margin-bottom:6px;">${escapeHtml(c.cite)}</div>`);
    if (c.year) parts.push(`<div style="font-size:10px;background:var(--color-background-tertiary);color:var(--color-text-secondary);border-radius:3px;padding:2px 6px;display:inline-block;margin-bottom:12px;">${c.year}</div>`);
    c.bodyParaIndices.forEach(idx => {
      const t = stripTagsToText(doc2.paragraphsXml[idx]);
      if (t) parts.push(`<p style="font-family:var(--font-serif);font-size:13px;margin-bottom:8px;">${escapeHtml(t)}</p>`);
    });
    bodyEl.innerHTML = `<div style="padding:28px 40px;">${parts.join('')}</div>`;
  }, [docs]);

  useEffect(() => { renderPreview(card); }, [card, renderPreview]);

  const handleCopyFormatted = async () => {
    if (!card) { showToast('No card selected'); return; }
    const doc = docs.get(card.docId);
    if (!doc) return;

    const sectionHtml = '';
    const tagHtml = card.tagParaIndex !== null
      ? `<h4 style="font-family:Arial,sans-serif;font-size:14pt;margin:0 0 4px 0;">${xmlParaToHtml(doc.paragraphsXml[card.tagParaIndex]).replace(/^<p[^>]*>|<\/p>$/g, '')}</h4>`
      : `<h4 style="font-family:Arial,sans-serif;font-size:14pt;font-weight:bold;margin:0 0 4px 0;">${escapeHtml(card.tag)}</h4>`;
    const citeHtml = card.cite
      ? (card.citeParaIndex !== null
          ? `<p style="font-family:Arial,sans-serif;font-size:10pt;margin:0 0 8px 0;">${xmlParaToHtml(doc.paragraphsXml[card.citeParaIndex]).replace(/^<p[^>]*>|<\/p>$/g, '')}</p>`
          : `<p style="font-family:Arial,sans-serif;font-size:10pt;font-weight:bold;margin:0 0 8px 0;">${escapeHtml(card.cite)}</p>`)
      : '';

    const bodyHtml = card.bodyParaIndices
      .map(idx => xmlParaToHtml(doc.paragraphsXml[idx]))
      .join('');

    const plainParts: string[] = [];
    plainParts.push(card.tag);
    if (card.cite) plainParts.push(card.cite);
    card.bodyParaIndices.forEach(idx => {
      const t = stripTagsToText(doc.paragraphsXml[idx]);
      if (t) plainParts.push(t);
    });
    const plainText = plainParts.join('\n\n');
    const htmlContent = `<div style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.4;color:#000;">${sectionHtml}${tagHtml}${citeHtml}${bodyHtml}</div>`;

    try {
      await writeClipboard(plainText, htmlContent);
      showToast('Copied formatted — paste into Word or Docs');
    } catch {
      await writeClipboard(plainText, null);
      showToast('Copied plain text (formatted copy unavailable)');
    }
  };

  const handleCopyPlain = async () => {
    if (!card) return;
    const doc = docs.get(card.docId);
    if (!doc) return;
    const parts: string[] = [];
    if (card.section) parts.push(card.section);
    parts.push(card.tag);
    if (card.cite) parts.push(card.cite);
    card.bodyParaIndices.forEach(idx => {
      const t = stripTagsToText(doc.paragraphsXml[idx]);
      if (t) parts.push(t);
    });
    await writeClipboard(parts.join('\n\n'), null);
    showToast('Copied plain text');
  };

  const handleDownload = async () => {
    if (!card) return;
    const doc = docs.get(card.docId);
    if (!doc) return;
    const blob = currentBlobRef.current || await buildCardDocx(card, doc);
    downloadFile(blob, safeFilename(card, doc));
  };

  return (
    <div className="right-pane">
      <div className="preview-toolbar" style={{ display: card ? '' : 'none' }}>
        <button className="primary" onClick={handleCopyFormatted}>Copy formatted</button>
        <button onClick={handleCopyPlain}>Copy plain text</button>
        <button onClick={handleDownload}>Download .docx</button>
        <span className="spacer"></span>
        <button onClick={() => onStepSelection(-1)}>← Prev</button>
        <button onClick={() => onStepSelection(1)}>Next →</button>
      </div>

      <div className="preview-body" ref={previewBodyRef}>
        <div className="preview-placeholder">
          <span className="big">←</span>
          Select a card from the list to view it here.
        </div>
      </div>

      {card && docs.get(card.docId) && (
        <div className="preview-footer">
          <span className="label">Source</span>
          <span className="source-name">{docs.get(card.docId)!.filename}</span>
          <span className="source-section">{card.section || ''}</span>
        </div>
      )}
    </div>
  );
};

export default CardPreview;
