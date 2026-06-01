import { DebateCard, SearchQuery, SearchClause, SearchResult } from '../types';

interface Token {
  type: 'phrase' | 'term' | 'fuzzy' | 'exclude' | 'op';
  value: string;
}

export class SearchEngine {
  tokenize(query: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    
    while (i < query.length) {
      if (/\s/.test(query[i])) { 
        i++; 
        continue; 
      }

      // Quoted phrase
      if (query[i] === '"') {
        const end = query.indexOf('"', i + 1);
        if (end !== -1) {
          const phrase = query.slice(i + 1, end).trim().toLowerCase();
          if (phrase) tokens.push({ type: 'phrase', value: phrase });
          i = end + 1;
          continue;
        }
      }

      // Read next word
      let word = '';
      while (i < query.length && !/\s/.test(query[i])) word += query[i++];
      if (!word) continue;

      const upper = word.toUpperCase();
      if (upper === 'AND' || upper === 'OR') {
        tokens.push({ type: 'op', value: upper });
      } else if (word.startsWith('-') && word.length > 1) {
        tokens.push({ type: 'exclude', value: word.slice(1).toLowerCase() });
      } else if (word.endsWith('~') && word.length > 1) {
        tokens.push({ type: 'fuzzy', value: word.slice(0, -1).toLowerCase() });
      } else {
        tokens.push({ type: 'term', value: word.toLowerCase() });
      }
    }
    return tokens;
  }

  parseQuery(query: string): SearchQuery {
    const q = (query || '').trim();
    if (!q) return { type: 'empty' };

    const tokens = this.tokenize(q);
    if (!tokens.length) return { type: 'empty' };

    if (tokens.length === 1 && tokens[0].type === 'phrase') {
      return { type: 'phrase', phrase: tokens[0].value };
    }

    const hasOp = tokens.some(t => t.type === 'op');

    if (!hasOp) {
      return {
        type: 'advanced',
        inclusions: tokens.filter(t => t.type === 'term').map(t => t.value),
        phrases: tokens.filter(t => t.type === 'phrase').map(t => t.value),
        fuzzyTerms: tokens.filter(t => t.type === 'fuzzy').map(t => t.value),
        exclusions: tokens.filter(t => t.type === 'exclude').map(t => t.value),
      };
    }

    const clauses: SearchClause[] = [];
    let pendingOp: string | null = null;
    for (const tok of tokens) {
      if (tok.type === 'op') { 
        pendingOp = tok.value; 
        continue; 
      }
      clauses.push({ 
        kind: tok.type as 'phrase' | 'term' | 'fuzzy' | 'exclude', 
        value: tok.value, 
        joinOp: pendingOp as 'AND' | 'OR' | null 
      });
      pendingOp = null;
    }
    return { type: 'boolean', clauses };
  }

  searchCard(card: DebateCard, query: string, scope: string): SearchResult {
    const pq = this.parseQuery(query);
    if (pq.type === 'empty') return { matches: true, score: 0 };
    
    const fields = this.getSearchFields(card, scope);
    
    switch (pq.type) {
      case 'phrase':
        return this.searchPhrase(fields, pq.phrase!);
      case 'boolean':
        return this.searchBoolean(fields, pq.clauses!);
      case 'advanced':
        return this.searchAdvanced(fields, pq);
      default:
        return { matches: false, score: 0 };
    }
  }

  private getSearchFields(card: DebateCard, scope: string): string[] {
    switch (scope) {
      case 'tag': return [card.searchTag];
      case 'cite': return [card.searchCite];
      case 'body': return [card.searchBody];
      default: return [card.searchAll];
    }
  }

  private searchPhrase(fields: string[], phrase: string): SearchResult {
    for (const field of fields) {
      if (field.includes(phrase)) {
        const pos = field.indexOf(phrase);
        const score = 100 - (pos / field.length * 50) + (phrase.length / field.length * 50);
        return { matches: true, score: Math.max(score, 10) };
      }
    }
    return { matches: false, score: 0 };
  }

  private searchBoolean(fields: string[], clauses: SearchClause[]): SearchResult {
    // Apply exclusions first
    for (const c of clauses) {
      if (c.kind !== 'exclude') continue;
      if (this.searchTerm(fields, c.value).matches) return { matches: false, score: 0 };
    }

    let result: boolean | null = null;
    let totalScore = 0;
    
    for (const c of clauses) {
      if (c.kind === 'exclude') continue;

      let r: SearchResult;
      if (c.kind === 'phrase') r = this.searchPhrase(fields, c.value);
      else if (c.kind === 'fuzzy') r = this.searchFuzzy(fields, c.value);
      else r = this.searchTerm(fields, c.value);

      if (result === null) {
        result = r.matches;
        totalScore = r.score;
      } else if (c.joinOp === 'AND') {
        result = result && r.matches;
        totalScore = Math.min(totalScore, r.score);
      } else {
        result = result || r.matches;
        totalScore = Math.max(totalScore, r.score);
      }
    }

    return { matches: result !== null ? result : true, score: totalScore };
  }

  private searchAdvanced(fields: string[], query: SearchQuery): SearchResult {
    let score = 0;
    let matchCount = 0;
    const positiveCount = (query.inclusions?.length || 0) + (query.phrases?.length || 0) + (query.fuzzyTerms?.length || 0);

    // Required terms
    for (const term of query.inclusions || []) {
      const r = this.searchTerm(fields, term);
      if (!r.matches) return { matches: false, score: 0 };
      score += r.score;
      matchCount++;
    }

    // Required phrases
    for (const phrase of query.phrases || []) {
      const r = this.searchPhrase(fields, phrase);
      if (!r.matches) return { matches: false, score: 0 };
      score += r.score;
      matchCount++;
    }

    // Fuzzy terms
    for (const term of query.fuzzyTerms || []) {
      const r = this.searchFuzzy(fields, term);
      if (!r.matches) {
        if ((query.inclusions?.length || 0) === 0 && (query.phrases?.length || 0) === 0)
          return { matches: false, score: 0 };
      } else {
        score += r.score * 0.8;
        matchCount++;
      }
    }

    // Exclusions
    for (const term of query.exclusions || []) {
      if (this.searchTerm(fields, term).matches) return { matches: false, score: 0 };
    }

    if (positiveCount === 0) return { matches: true, score: 0 };
    return { matches: matchCount > 0, score };
  }

  private searchTerm(fields: string[], term: string): SearchResult {
    for (const field of fields) {
      if (field.includes(term)) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const occurrences = (field.match(new RegExp(safe, 'g')) || []).length;
        const density = occurrences / field.split(' ').length;
        const pos = field.indexOf(term);
        const posScore = 100 - (pos / field.length * 30);
        return { 
          matches: true, 
          score: Math.max((density * 100) + (posScore * 0.3) + (term.length * 2), 5) 
        };
      }
    }
    return { matches: false, score: 0 };
  }

  private searchFuzzy(fields: string[], term: string): SearchResult {
    let best = 0;
    for (const field of fields) {
      for (const word of field.split(/\s+/)) {
        const sim = this.similarity(term, word);
        if (sim > best) best = sim;
      }
    }
    if (best >= 0.7) return { matches: true, score: best * 50 };
    return { matches: false, score: 0 };
  }

  private similarity(a: string, b: string): number {
    const aLen = a.length;
    const bLen = b.length;
    if (aLen === 0) return bLen === 0 ? 1 : 0;
    if (bLen === 0) return 0;
    
    const matrix: number[][] = [];
    for (let i = 0; i <= bLen; i++) matrix[i] = [i];
    for (let j = 0; j <= aLen; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= bLen; i++) {
      for (let j = 1; j <= aLen; j++) {
        matrix[i][j] = b[i-1] === a[j-1]
          ? matrix[i-1][j-1]
          : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
      }
    }
    
    return 1 - matrix[bLen][aLen] / Math.max(aLen, bLen);
  }
}