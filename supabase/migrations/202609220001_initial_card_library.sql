create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.tournaments (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  name text not null,
  season text,
  starts_on date,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default extensions.gen_random_uuid(),
  file_hash text not null unique,
  filename text not null,
  source_path text not null,
  storage_key text not null unique,
  collection_name text,
  school text,
  team_name text,
  tournament_id uuid references public.tournaments(id) on delete set null,
  uploaded_by text,
  processing_status text not null default 'queued'
    check (processing_status in ('queued','processing','completed','completed_with_warnings','failed')),
  parser_version text not null,
  card_count integer not null default 0 check (card_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.cards (
  id uuid primary key default extensions.gen_random_uuid(),
  content_hash text not null unique,
  tag text not null,
  cite text not null,
  body_text text not null,
  author text,
  evidence_year integer check (evidence_year is null or evidence_year between 1900 and 2100),
  embedding extensions.vector(384),
  source_count integer not null default 1 check (source_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(tag, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(cite, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_text, '')), 'C')
  ) stored
);

create table public.card_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  section_path text,
  tag_paragraph_index integer,
  cite_paragraph_indices integer[] not null default '{}',
  undertag_paragraph_indices integer[] not null default '{}',
  body_paragraph_indices integer[] not null default '{}',
  formatted_paragraphs jsonb,
  generated_docx_key text,
  created_at timestamptz not null default now(),
  unique (card_id, document_id, tag_paragraph_index)
);

create table public.ingestion_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  archive_name text not null,
  storage_key text not null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','completed_with_warnings','failed')),
  total_documents integer not null default 0,
  processed_documents integer not null default 0,
  unique_cards integer not null default 0,
  duplicate_cards integer not null default 0,
  failed_documents integer not null default 0,
  uploaded_by text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index cards_search_vector_gin on public.cards using gin (search_vector);
create index cards_embedding_hnsw on public.cards using hnsw (embedding vector_cosine_ops);
create index cards_author_trgm on public.cards using gin (author gin_trgm_ops);
create index cards_year_idx on public.cards (evidence_year);
create index card_sources_document_idx on public.card_sources (document_id);
create index documents_tournament_idx on public.documents (tournament_id);
create index documents_school_team_idx on public.documents (school, team_name);

alter table public.tournaments enable row level security;
alter table public.documents enable row level security;
alter table public.cards enable row level security;
alter table public.card_sources enable row level security;
alter table public.ingestion_jobs enable row level security;

create policy "Public tournaments are readable" on public.tournaments for select using (true);
create policy "Completed documents are readable" on public.documents for select using (processing_status in ('completed','completed_with_warnings'));
create policy "Cards are publicly readable" on public.cards for select using (true);
create policy "Card sources are publicly readable" on public.card_sources for select using (true);

create or replace function public.hybrid_search_cards(
  search_text text,
  query_embedding extensions.vector(384),
  result_limit integer default 25,
  year_min integer default null,
  year_max integer default null
)
returns table (
  id uuid,
  tag text,
  cite text,
  body_text text,
  author text,
  evidence_year integer,
  source_count integer,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with query as (
    select websearch_to_tsquery('english', search_text) value
  ),
  keyword as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.search_vector, q.value) desc) keyword_rank
    from public.cards c cross join query q
    where c.search_vector @@ q.value
      and (year_min is null or c.evidence_year >= year_min)
      and (year_max is null or c.evidence_year <= year_max)
    order by ts_rank_cd(c.search_vector, q.value) desc
    limit 100
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) semantic_rank
    from public.cards c
    where c.embedding is not null
      and (year_min is null or c.evidence_year >= year_min)
      and (year_max is null or c.evidence_year <= year_max)
    order by c.embedding <=> query_embedding
    limit 100
  ),
  fused as (
    select coalesce(k.id, s.id) id,
           coalesce(1.0 / (60 + k.keyword_rank), 0.0) +
           coalesce(1.0 / (60 + s.semantic_rank), 0.0) score
    from keyword k full outer join semantic s on s.id = k.id
  )
  select c.id, c.tag, c.cite, c.body_text, c.author, c.evidence_year, c.source_count, f.score
  from fused f join public.cards c on c.id = f.id
  order by f.score desc
  limit least(greatest(result_limit, 1), 100);
$$;

grant execute on function public.hybrid_search_cards(text, extensions.vector, integer, integer, integer) to anon, authenticated;
