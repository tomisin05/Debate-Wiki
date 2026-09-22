import { Pool } from 'pg';

export type SearchSort = 'relevance' | 'year-new' | 'year-old' | 'newest';

export interface CardSearchInput {
  query: string;
  page: number;
  limit: number;
  yearMin?: number;
  yearMax?: number;
  author?: string;
  collection?: string;
  school?: string;
  teamName?: string;
  sort: SearchSort;
  scope: 'all' | 'tag' | 'cite' | 'body';
}

export class SearchRepository {
  readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.SEARCH_DB_POOL_SIZE || 10),
      ssl: { rejectUnauthorized: false },
      statement_timeout: 5000,
      query_timeout: 6000,
    });
  }

  async close() { await this.pool.end(); }

  async search(input: CardSearchInput) {
    const orderBy: Record<SearchSort, string> = {
      relevance: 'score desc, c.id',
      'year-new': 'c.evidence_year desc nulls last, c.id',
      'year-old': 'c.evidence_year asc nulls last, c.id',
      newest: 'c.created_at desc, c.id',
    };
    const offset = (input.page - 1) * input.limit;
    const result = await this.pool.query(`
      with search_input as (
        select case when btrim($1::text) = '' then null
                    else websearch_to_tsquery('english', $1::text) end as query
      ), matched as (
        select c.*,
               case when i.query is null then 0
                    else ts_rank_cd(c.search_vector, i.query, 32) end as score
        from public.cards c
        cross join search_input i
        where (
          i.query is null
          or (
            c.search_vector @@ i.query
            and case $10::text
              when 'tag' then to_tsvector('english', coalesce(c.tag, '')) @@ i.query
              when 'cite' then to_tsvector('english', coalesce(c.cite, '')) @@ i.query
              when 'body' then to_tsvector('english', coalesce(c.body_text, '')) @@ i.query
              else true
            end
          )
        )
          and ($2::integer is null or c.evidence_year >= $2)
          and ($3::integer is null or c.evidence_year <= $3)
          and ($4::text is null or c.author ilike '%' || $4 || '%')
          and (
            ($5::text is null and $6::text is null and $7::text is null)
            or exists (
              select 1
              from public.card_sources filter_source
              join public.documents filter_document on filter_document.id = filter_source.document_id
              where filter_source.card_id = c.id
                and ($5::text is null or lower(filter_document.collection_name) = lower($5))
                and ($6::text is null or lower(filter_document.school) = lower($6))
                and ($7::text is null or lower(filter_document.team_name) = lower($7))
            )
          )
      )
      select c.id, c.tag, c.cite, c.body_text, c.author, c.evidence_year,
             c.source_count, c.score, count(*) over()::int as total,
             source.document_id, source.filename, source.source_path,
             source.collection_name, source.school, source.team_name,
             source.section_path, source.tag_paragraph_index,
             source.cite_paragraph_indices, source.undertag_paragraph_indices,
             source.body_paragraph_indices, source.formatted_paragraphs
      from matched c
      left join lateral (
        select cs.document_id, d.filename, d.source_path, d.collection_name,
               d.school, d.team_name, cs.section_path, cs.tag_paragraph_index,
               cs.cite_paragraph_indices, cs.undertag_paragraph_indices,
               cs.body_paragraph_indices, cs.formatted_paragraphs
        from public.card_sources cs
        join public.documents d on d.id = cs.document_id
        where cs.card_id = c.id
        order by cs.created_at, cs.id
        limit 1
      ) source on true
      order by ${orderBy[input.sort]}
      limit $8 offset $9
    `, [
      input.query, input.yearMin ?? null, input.yearMax ?? null,
      input.author ?? null, input.collection ?? null, input.school ?? null,
      input.teamName ?? null, input.limit, offset, input.scope,
    ]);

    const total = result.rows[0]?.total ?? 0;
    return {
      items: result.rows.map(toCard),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async getCard(id: string) {
    const cardResult = await this.pool.query(
      `select id, tag, cite, body_text, author, evidence_year, source_count
       from public.cards where id=$1`, [id],
    );
    if (!cardResult.rows[0]) return null;
    const sources = await this.pool.query(`
      select cs.document_id, d.filename, d.source_path, d.collection_name,
             d.school, d.team_name, cs.section_path, cs.tag_paragraph_index,
             cs.cite_paragraph_indices, cs.undertag_paragraph_indices,
             cs.body_paragraph_indices, cs.formatted_paragraphs
      from public.card_sources cs
      join public.documents d on d.id=cs.document_id
      where cs.card_id=$1
      order by cs.created_at, cs.id
    `, [id]);
    return { ...baseCard(cardResult.rows[0]), sources: sources.rows.map(toSource) };
  }

  async filters() {
    const [collections, schools, teams, stats] = await Promise.all([
      this.pool.query(`select distinct collection_name value from public.documents where collection_name is not null and collection_name <> '' order by value`),
      this.pool.query(`select distinct school value from public.documents where school is not null and school <> '' order by value`),
      this.pool.query(`select distinct team_name value from public.documents where team_name is not null and team_name <> '' order by value`),
      this.pool.query(`select (select count(*)::int from public.documents where processing_status in ('completed','completed_with_warnings')) documents, (select count(*)::int from public.cards) cards`),
    ]);
    return {
      collections: collections.rows.map(row => row.value),
      schools: schools.rows.map(row => row.value),
      teams: teams.rows.map(row => row.value),
      documents: stats.rows[0].documents,
      cards: stats.rows[0].cards,
    };
  }
}

function baseCard(row: any) {
  return {
    id: row.id,
    tag: row.tag,
    cite: row.cite,
    body: row.body_text,
    author: row.author,
    year: row.evidence_year,
    sourceCount: row.source_count,
  };
}

function toCard(row: any) {
  return {
    ...baseCard(row),
    score: Number(row.score || 0),
    source: row.document_id ? toSource(row) : null,
  };
}

function toSource(row: any) {
  return {
    documentId: row.document_id,
    filename: row.filename,
    sourcePath: row.source_path,
    collection: row.collection_name,
    school: row.school,
    teamName: row.team_name,
    section: row.section_path,
    tagParagraphIndex: row.tag_paragraph_index,
    citeParagraphIndices: row.cite_paragraph_indices,
    undertagParagraphIndices: row.undertag_paragraph_indices,
    bodyParagraphIndices: row.body_paragraph_indices,
    formattedParagraphs: row.formatted_paragraphs,
  };
}
