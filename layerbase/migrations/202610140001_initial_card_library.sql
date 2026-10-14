create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  season text,
  starts_on date,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
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
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique,
  tag text not null,
  cite text not null,
  body_text text not null,
  author text,
  evidence_year integer check (evidence_year is null or evidence_year between 1900 and 2100),
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
  id uuid primary key default gen_random_uuid(),
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
  id uuid primary key default gen_random_uuid(),
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
create index cards_author_trgm on public.cards using gin (author gin_trgm_ops);
create index cards_tag_simple_search_idx on public.cards using gin (to_tsvector('simple', coalesce(tag, '')));
create index cards_year_idx on public.cards (evidence_year);
create index cards_author_lower_idx on public.cards (lower(author));
create index cards_created_at_idx on public.cards (created_at desc, id);
create index card_sources_document_idx on public.card_sources (document_id);
create index documents_tournament_idx on public.documents (tournament_id);
create index documents_school_team_idx on public.documents (school, team_name);
create index documents_collection_lower_idx on public.documents (lower(collection_name));
create index documents_school_lower_idx on public.documents (lower(school));
create index documents_team_name_lower_idx on public.documents (lower(team_name));
