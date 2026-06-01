import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import { MergeFile } from '../types';

interface MergePanelProps {
  onClose: () => void;
}

const SKIP_REL_TYPE_ENDS = new Set([
  'styles','settings','theme','fontTable','webSettings',
  'numbering','endnotes','footnotes','comments',
  'customXml','customXmlProps','glossaryDocument',
]);

function parseRels(xml: string) {
  const rels: any[] = [];
  const re = /<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const a = m[1];
    const id   = (a.match(/\bId="([^"]*)"/) || [])[1];
    const type = (a.match(/\bType="([^"]*)"/) || [])[1];
    const tgt  = (a.match(/\bTarget="([^"]*)"/) || [])[1];
    const mode = (a.match(/\bTargetMode="([^"]*)"/) || [])[1] || null;
    if (id && type && tgt) rels.push({ id, type, target: tgt, targetMode: mode });
  }
  return rels;
}

function buildRelsXml(rels: any[]) {
  const body = rels.map(r => {
    const mode = r.targetMode ? ` TargetMode="${r.targetMode}"` : '';
    return `  <Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${mode}/>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n${body}\n</Relationships>`;
}

function remapRelIds(xml: string, idMap: Record<string, string>) {
  return xml.replace(/\b(r:id|r:embed|r:link)="([^"]*)"/g, (match, attr, oldId) => {
    const newId = idMap[oldId];
    return newId ? `${attr}="${newId}"` : match;
  });
}

function extractBodyParas(docXml: string): string[] {
  const bodyMatch = docXml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return [];
  const body = bodyMatch[1];
  const paras: string[] = [];
  let pos = 0;
  while (pos < body.length) {
    const start = body.indexOf('<w:p', pos);
    if (start === -1) break;
    const ch = body[start + 4];
    if (ch !== ' ' && ch !== '>' && ch !== '/') { pos = start + 4; continue; }
    const tagEnd = body.indexOf('>', start);
    if (tagEnd === -1) break;
    if (body[tagEnd - 1] === '/') {
      paras.push(body.slice(start, tagEnd + 1)); pos = tagEnd + 1;
    } else {
      const close = body.indexOf('</w:p>', tagEnd);
      if (close === -1) break;
      paras.push(body.slice(start, close + 6)); pos = close + 6;
    }
  }
  return paras;
}

function buildMergedDocXml(baseDocXml: string | null, allParas: string[]): string {
  let sectPr = '';
  if (baseDocXml) {
    const sm = baseDocXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
    if (sm) sectPr = sm[0];
  }
  const parasXml = allParas.join('\n');
  if (baseDocXml) {
    return baseDocXml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, m => {
      const open = m.match(/^<w:body\b[^>]*>/)![0];
      return `${open}${parasXml}${sectPr}</w:body>`;
    });
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parasXml}${sectPr}</w:body></w:document>`;
}

async function patchContentTypes(outZip: JSZip, addedExtensions: Set<string>) {
  const ctFile = outZip.file('[Content_Types].xml');
  if (!ctFile || !addedExtensions.size) return;
  let ctXml = await ctFile.async('string');
  for (const ext of addedExtensions) {
    if (ctXml.includes(`Extension="${ext}"`)) continue;
    const mime: Record<string, string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', wmf:'image/x-wmf', emf:'image/x-emf', svg:'image/svg+xml', tif:'image/tiff', tiff:'image/tiff', bmp:'image/bmp' };
    ctXml = ctXml.replace('</Types>', `  <Default Extension="${ext}" ContentType="${mime[ext] || 'application/octet-stream'}"/>\n</Types>`);
  }
  outZip.file('[Content_Types].xml', ctXml);
}

function fmtSize(b: number) {
  return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const tick = () => new Promise(r => setTimeout(r, 0));

const MergePanel: React.FC<MergePanelProps> = ({ onClose }) => {
  const [mergeFiles, setMergeFiles] = useState<MergeFile[]>([]);
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [status, setStatus] = useState('');
  const nextIdRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const addFiles = (files: File[]) => {
    const docx = files.filter(f => f.name.toLowerCase().endsWith('.docx'));
    setMergeFiles(prev => [...prev, ...docx.map(f => ({ file: f, id: nextIdRef.current++ }))]);
    setStatus('');
  };

  const removeFile = (id: number) => setMergeFiles(prev => prev.filter(f => f.id !== id));

  const moveFile = (id: number, dir: number) => {
    setMergeFiles(prev => {
      const arr = [...prev];
      const idx = arr.findIndex(f => f.id === id);
      const ni = idx + dir;
      if (idx === -1 || ni < 0 || ni >= arr.length) return prev;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return arr;
    });
  };

  const doMerge = async () => {
    if (mergeFiles.length < 2 || merging) return;
    setMerging(true);
    setShowProgress(true);
    setProgress(0);

    try {
      const zips: { name: string; zip: JSZip }[] = [];
      for (let i = 0; i < mergeFiles.length; i++) {
        setStatus(`Loading ${mergeFiles[i].file.name}…`);
        setProgress((i / mergeFiles.length) * 30);
        const buf = await mergeFiles[i].file.arrayBuffer();
        zips.push({ name: mergeFiles[i].file.name, zip: await JSZip.loadAsync(buf) });
        await tick();
      }

      setStatus('Building merged document…');
      setProgress(35);

      const baseZip = zips[0].zip;
      const outZip = new JSZip();

      for (const [path, entry] of Object.entries(baseZip.files) as any) {
        if (entry.dir) continue;
        if (path === 'word/document.xml' || path === 'word/_rels/document.xml.rels') continue;
        outZip.file(path, await entry.async('uint8array'));
      }

      const baseRelsFile = baseZip.file('word/_rels/document.xml.rels');
      const baseRelsXml = baseRelsFile ? await baseRelsFile.async('string') : '';
      const mergedRels = parseRels(baseRelsXml);

      let nextRid = 1;
      for (const r of mergedRels) {
        const n = parseInt(r.id.replace(/\D/g, ''), 10);
        if (!isNaN(n) && n >= nextRid) nextRid = n + 1;
      }

      const addedExts = new Set<string>();
      const allParas: string[] = [];
      const baseDocXmlFile = baseZip.file('word/document.xml');
      const baseDocXml = baseDocXmlFile ? await baseDocXmlFile.async('string') : null;

      for (let i = 0; i < zips.length; i++) {
        const { name, zip } = zips[i];
        setStatus(`Merging ${name}…`);
        setProgress(35 + (i / zips.length) * 50);
        await tick();

        const docXmlFile = zip.file('word/document.xml');
        if (!docXmlFile) continue;
        let docXml = await docXmlFile.async('string');

        if (i === 0) { allParas.push(...extractBodyParas(docXml)); continue; }

        const relsFile = zip.file('word/_rels/document.xml.rels');
        const relsXml = relsFile ? await relsFile.async('string') : '';
        const docRels = parseRels(relsXml);
        const idMap: Record<string, string> = {};

        for (const rel of docRels) {
          const typeEnd = rel.type.split('/').pop();
          if (SKIP_REL_TYPE_ENDS.has(typeEnd)) continue;
          const dup = mergedRels.find(r => r.type === rel.type && r.target === rel.target && r.targetMode === rel.targetMode);
          if (dup) { idMap[rel.id] = dup.id; continue; }
          const newId = `rId${nextRid++}`;
          idMap[rel.id] = newId;
          if (rel.targetMode === 'External') {
            mergedRels.push({ ...rel, id: newId });
          } else {
            const srcPath = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`;
            const srcFile = zip.file(srcPath) || zip.file(`word/${rel.target}`);
            if (srcFile) {
              const ext = rel.target.split('.').pop()!.toLowerCase();
              const base = rel.target.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
              const newFileName = `media/${base}_${newId}.${ext}`;
              outZip.file(`word/${newFileName}`, await srcFile.async('uint8array'));
              addedExts.add(ext);
              mergedRels.push({ ...rel, id: newId, target: newFileName });
            } else {
              mergedRels.push({ ...rel, id: newId });
            }
          }
        }
        docXml = remapRelIds(docXml, idMap);
        allParas.push(...extractBodyParas(docXml));
      }

      setStatus('Writing output…');
      setProgress(88);
      outZip.file('word/_rels/document.xml.rels', buildRelsXml(mergedRels));
      outZip.file('word/document.xml', buildMergedDocXml(baseDocXml, allParas));
      await patchContentTypes(outZip, addedExts);

      setProgress(95);
      setStatus('Generating file…');
      const blob = await outZip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      setProgress(100);
      setStatus(`✓ ${mergeFiles.length} documents merged successfully`);

      const baseName = mergeFiles[0].file.name.replace(/\.docx$/i, '');
      downloadFile(blob, `merged_${baseName}_+${mergeFiles.length - 1}more.docx`);
    } catch (err: any) {
      setStatus(`Error: ${err.message || err}`);
      console.error('Merge error:', err);
    } finally {
      setMerging(false);
      setTimeout(() => setShowProgress(false), 2000);
    }
  };

  return (
    <div className="merge-overlay show" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="merge-panel">
        <div className="merge-panel-header">
          <h2>Merge Docs <span className="sub">combine multiple .docx into one</span></h2>
          <button className="merge-panel-close" onClick={onClose}>✕</button>
        </div>

        <div
          ref={dropZoneRef}
          className="merge-drop-zone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); dropZoneRef.current?.classList.add('dragover'); }}
          onDragLeave={() => dropZoneRef.current?.classList.remove('dragover')}
          onDrop={e => { e.preventDefault(); dropZoneRef.current?.classList.remove('dragover'); addFiles(Array.from(e.dataTransfer.files)); }}
        >
          <span className="dz-icon">📂</span>
          <div className="dz-label">Drop .docx files here, or click to browse</div>
          <div className="dz-sub">Files will be merged in the order listed below</div>
        </div>
        <input ref={fileInputRef} type="file" accept=".docx" multiple style={{ display: 'none' }}
          onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />

        <div className="merge-file-list">
          {mergeFiles.length === 0 ? (
            <div className="mfl-empty">No files added yet</div>
          ) : (
            <>
              <div className="merge-file-list-header">
                <span>Files to merge</span>
                <span className="mfl-count">{mergeFiles.length} file{mergeFiles.length !== 1 ? 's' : ''}</span>
              </div>
              {mergeFiles.map((entry, idx) => (
                <div key={entry.id} className="merge-file-item">
                  <span className="mfi-order">{idx + 1}</span>
                  <span className="mfi-icon">📄</span>
                  <span className="mfi-name" title={entry.file.name}>{entry.file.name}</span>
                  <span className="mfi-size">{fmtSize(entry.file.size)}</span>
                  <span className="mfi-btns">
                    <button className="mfi-btn" disabled={idx === 0} onClick={() => moveFile(entry.id, -1)}>↑</button>
                    <button className="mfi-btn" disabled={idx === mergeFiles.length - 1} onClick={() => moveFile(entry.id, 1)}>↓</button>
                    <button className="mfi-btn danger" onClick={() => removeFile(entry.id)}>✕</button>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="merge-panel-footer">
          <div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="btn-merge" disabled={mergeFiles.length < 2 || merging} onClick={doMerge}>
                ⬇️ Merge &amp; Download
              </button>
              {mergeFiles.length > 0 && (
                <button className="btn-merge-clear" onClick={() => { setMergeFiles([]); setStatus(''); }}>
                  Clear list
                </button>
              )}
            </div>
            {showProgress && (
              <div className="merge-progress-bar show">
                <div style={{ width: `${progress}%` }}></div>
              </div>
            )}
            {status && <div className="merge-status show">{status}</div>}
          </div>
          <div className="merge-info">Formatting, styles, and bold/underline are preserved from each source document.</div>
        </div>
      </div>
    </div>
  );
};

export default MergePanel;
