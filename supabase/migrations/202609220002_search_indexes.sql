create index if not exists documents_collection_lower_idx
  on public.documents (lower(collection_name));
create index if not exists documents_school_lower_idx
  on public.documents (lower(school));
create index if not exists documents_team_name_lower_idx
  on public.documents (lower(team_name));
create index if not exists cards_author_lower_idx
  on public.cards (lower(author));
create index if not exists cards_created_at_idx
  on public.cards (created_at desc, id);
