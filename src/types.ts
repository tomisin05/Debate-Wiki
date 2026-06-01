export interface DebateCard {
  id: string;
  docId: string;
  docName: string;
  section: string;
  tag: string;
  cite: string;
  tagParaIndex: number | null;
  citeParaIndex: number | null;
  bodyParaIndices: number[];
  bodyPlain: string;
  year: number | null;
  dupKey: string;
  searchTag: string;
  searchCite: string;
  searchBody: string;
  searchAll: string;
  snippetHtml: string;
  author: string;
  searchScore?: number;
  userId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DebateDocument {
  id: string;
  filename: string;
  shortName: string;
  zipData: any;
  rawXml: string;
  paragraphsXml: string[];
  userId?: string;
  createdAt?: Date;
}

export interface AppState {
  docs: Map<string, DebateDocument>;
  cards: DebateCard[];
  filtered: DebateCard[];
  selectedCardId: string | null;
  search: string;
  searchScope: 'all' | 'tag' | 'cite' | 'body';
  docFilter: string;
  sectionFilter: string;
  sortOrder: 'doc' | 'alpha' | 'year-new' | 'year-old' | 'taglen' | 'relevance';
  yearMin: string;
  yearMax: string;
  dedupEnabled: boolean;
  nextDocId: number;
  nextCardId: number;
  currentPreviewBlob: Blob | null;
  currentPreviewCard: DebateCard | null;
}

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface SearchQuery {
  type: 'empty' | 'phrase' | 'advanced' | 'boolean';
  phrase?: string;
  inclusions?: string[];
  phrases?: string[];
  fuzzyTerms?: string[];
  exclusions?: string[];
  clauses?: SearchClause[];
}

export interface SearchClause {
  kind: 'phrase' | 'term' | 'fuzzy' | 'exclude';
  value: string;
  joinOp: 'AND' | 'OR' | null;
}

export interface SearchResult {
  matches: boolean;
  score: number;
}

export interface MergeFile {
  file: File;
  id: number;
}