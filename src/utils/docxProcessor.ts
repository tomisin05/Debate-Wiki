import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import { DebateCard, DebateDocument } from '../types.js';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type Kind = 'pocket'|'hat'|'block'|'tag'|'analytic'|'undertag'|'paragraph';
interface Style { id:string; name:string; type:string; basedOn:string|null; ownOutline:number|null; ownBold:boolean|null; outline:number|null; bold:boolean|null }
interface Para { index:number; kind:Kind; text:string; cite:boolean }
const STRUCTURAL:Record<string,Kind>={Heading1:'pocket',Heading2:'hat',Heading3:'block',Heading4:'tag',Analytic:'analytic',Undertag:'undertag'};
const CITE_IDS=new Set(['Style13ptBold','StyleStyleBold12pt','Cite','Author-Date']);
const CITE_NAMES=new Set(['style 13 pt bold','style style bold + 12 pt','cite','author-date']);

function attr(el:XmlElement|null,name:string):string|null{return el?Array.from(el.attributes).find(a=>a.localName===name)?.value??null:null}
function child(el:XmlElement|null,name:string):XmlElement|null{return el?Array.from(el.children).find(c=>c.namespaceURI===NS&&c.localName===name)??null:null}
function bool(el:XmlElement|null):boolean|null{if(!el)return null;const v=attr(el,'val');return v==='0'||v==='false'||v==='off'?false:true}
function compact(s:string){return s.toLowerCase().replace(/\s+/g,'')}

function parseStyles(source?:string):Map<string,Style>{
  const out=new Map<string,Style>(); if(!source)return out;
  const xml=new DOMParser().parseFromString(source,'application/xml');
  for(const el of Array.from(xml.getElementsByTagNameNS(NS,'style'))){
    const id=attr(el,'styleId');if(!id)continue;const pPr=child(el,'pPr'),rPr=child(el,'rPr');
    const raw=attr(child(pPr,'outlineLvl'),'val'),n=raw===null?NaN:parseInt(raw,10);
    out.set(id,{id,name:attr(child(el,'name'),'val')||'',type:attr(el,'type')||'',basedOn:attr(child(el,'basedOn'),'val'),ownOutline:Number.isFinite(n)?n:null,ownBold:bool(child(rPr,'b')),outline:null,bold:null});
  }
  const resolve=(id:string,seen=new Set<string>()):{outline:number|null;bold:boolean|null}=>{const s=out.get(id);if(!s||seen.has(id))return{outline:null,bold:null};seen.add(id);const p=s.basedOn?resolve(s.basedOn,seen):{outline:null,bold:null};seen.delete(id);return{outline:s.ownOutline??p.outline,bold:s.ownBold??p.bold}};
  for(const s of out.values())Object.assign(s,resolve(s.id)); return out;
}

export const paragraphText=(p:XmlElement):string=>Array.from(p.getElementsByTagNameNS(NS,'t')).map(n=>n.textContent||'').join('').trim();
export const styleVal=(p:XmlElement):string|null=>attr(child(child(p,'pPr'),'pStyle'),'val');
function outline(p:XmlElement,s?:Style):number|null{const v=attr(child(child(p,'pPr'),'outlineLvl'),'val');if(v!==null){const n=parseInt(v,10);if(Number.isFinite(n))return n}return s?.outline??null}
function runBold(r:XmlElement,styles:Map<string,Style>){const rp=child(r,'rPr'),direct=bool(child(rp,'b'));if(direct!==null)return direct;const id=attr(child(rp,'rStyle'),'val');return !!id&&styles.get(id)?.bold===true}
function runSize(r:XmlElement){const v=attr(child(child(r,'rPr'),'sz'),'val');return v?parseInt(v,10)/2:null}
function runUnderline(r:XmlElement){const v=attr(child(child(r,'rPr'),'u'),'val');return v!==null&&v!=='none'&&v!=='0'}

function classify(p:XmlElement,styles:Map<string,Style>):Kind{
  const id=styleVal(p);if(id&&STRUCTURAL[id])return STRUCTURAL[id];const s=id?styles.get(id):undefined;
  const token=compact(`${id||''} ${s?.name||''}`),name=compact(s?.name||id||'');
  if(token.includes('undertag'))return'undertag';if(token.includes('analytic'))return'analytic';
  if(/^(tags?|debatetag|heading4)$/.test(name))return'tag';
  const level=outline(p,s),runs=Array.from(p.getElementsByTagNameNS(NS,'r'));
  if(level===0&&runs.some(r=>runBold(r,styles)&&runSize(r)===26))return'pocket';
  if(level===1&&runs.some(r=>runBold(r,styles)&&runSize(r)===22))return'hat';
  if(level===2&&runs.some(r=>runBold(r,styles)&&runUnderline(r)&&runSize(r)===16))return'block';
  if(level===3&&(s?.bold===true||runs.some(r=>runBold(r,styles))))return'tag';
  if(level===0)return'pocket';if(level===1)return'hat';if(level===2)return'block';return'paragraph';
}

function citeMarked(p:XmlElement,styles:Map<string,Style>):boolean{
  for(const r of Array.from(p.getElementsByTagNameNS(NS,'r'))){if(!paragraphText(r))continue;const id=attr(child(child(r,'rPr'),'rStyle'),'val');if(!id)continue;const name=styles.get(id)?.name.toLowerCase()||'';if(CITE_IDS.has(id)||CITE_NAMES.has(name))return true}return false;
}
export const isHeading=(p:XmlElement,level:number)=>styleVal(p)?.toLowerCase()===`heading${level}`;
export const isCitation=(p:XmlElement)=>citeMarked(p,new Map());
export const extractParagraphsXml=(raw:string):string[]=>{
  const xml=new DOMParser().parseFromString(raw,'application/xml'),serializer=new XMLSerializer();
  return Array.from(xml.getElementsByTagNameNS(NS,'p')).map(p=>serializer.serializeToString(p));
};
export const decodeXmlEntities=(s:string)=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export const stripTagsToText=(xml:string)=>Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),m=>decodeXmlEntities(m[1])).join('');
export const escapeHtml=(s:string)=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const normKey=(s:string)=>(s||'').toLowerCase().replace(/\s+/g,' ').trim();
export const extractYear=(s:string):number|null=>{const f=s.match(/\b(19[5-9]\d|20\d{2})\b/);if(f)return+f[1];const m=s.match(/['’](\d{2})\b/);if(!m)return null;const n=+m[1];return n<=35?2000+n:1900+n};
export const extractAuthor=(s:string):string=>{const m=s.match(/^([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*(?:\s+et\s+al\.?)?)\s+['’]?\d{2}/),f=s.split(/[,.]/)[0].trim();return m?.[1]||f.substring(0,40)||'Unknown'};

export async function processDocxFile(file:File, metadata?:Partial<Pick<DebateDocument,'sourcePath'|'collection'|'school'|'teamName'>>):Promise<DebateDocument>{
  const zip=await JSZip.loadAsync(await file.arrayBuffer()),part=zip.file('word/document.xml');if(!part)throw new Error('Invalid DOCX file: missing word/document.xml');
  const rawXml=await part.async('string'),stylesXml=await zip.file('word/styles.xml')?.async('string');
  return{id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,filename:file.name,shortName:file.name.replace(/\.docx$/i,''),zipData:zip,rawXml,stylesXml,paragraphsXml:extractParagraphsXml(rawXml),...metadata};
}
function parseParagraphs(doc:DebateDocument):Para[]{const xml=new DOMParser().parseFromString(doc.rawXml,'application/xml');if(xml.getElementsByTagName('parsererror').length)throw new Error('Invalid word/document.xml');const styles=parseStyles(doc.stylesXml);return Array.from(xml.getElementsByTagNameNS(NS,'p')).map((p,index)=>({index,kind:classify(p,styles),text:paragraphText(p),cite:citeMarked(p,styles)}))}

export function parseCardsFromDoc(doc:DebateDocument):DebateCard[]{
  const ps=parseParagraphs(doc),cards:DebateCard[]=[],heads:Partial<Record<'pocket'|'hat'|'block',string>>={};
  for(let i=0;i<ps.length;){const p=ps[i];
    if(p.kind==='pocket'||p.kind==='hat'||p.kind==='block'){heads[p.kind]=p.text;if(p.kind==='pocket'){delete heads.hat;delete heads.block}else if(p.kind==='hat')delete heads.block;i++;continue}
    if(p.kind!=='tag'){i++;continue}
    const undertags:number[]=[],cites:number[]=[],bodies:number[]=[];let j=i+1;
    while(j<ps.length&&ps[j].kind==='undertag')undertags.push(ps[j++].index);
    while(j<ps.length&&ps[j].kind==='paragraph'){const q=ps[j++];(q.cite?cites:bodies).push(q.index)}
    const cite=cites.map(x=>stripTagsToText(doc.paragraphsXml[x])).filter(Boolean).join(' '),bodyPlain=bodies.map(x=>stripTagsToText(doc.paragraphsXml[x])).join(' ').replace(/\s+/g,' ').trim(),section=[heads.pocket,heads.hat,heads.block].filter(Boolean).join(' › ');
    if (!bodyPlain) { i=j; continue; }
    cards.push({id:`${doc.id}-${cards.length+1}`,docId:doc.id,docName:doc.shortName,section,tag:p.text,cite,tagParaIndex:p.index,citeParaIndex:cites[0]??null,citeParaIndices:cites,undertagParaIndices:undertags,bodyParaIndices:bodies,bodyPlain,year:extractYear(cite),dupKey:`${normKey(p.text)}|||${normKey(cite)}`,searchTag:p.text.toLowerCase(),searchCite: cite.toLowerCase(),searchBody:bodyPlain.toLowerCase(),searchAll:`${p.text} ${cite} ${bodyPlain}`.toLowerCase(),snippetHtml:escapeHtml(bodyPlain.substring(0,200)),author:extractAuthor(cite)});i=j;
  }return cards;
}
