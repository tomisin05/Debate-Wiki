-- Preserve short negation words for tag-only searches without changing the
-- English full-text index used by general card searches.
create index if not exists cards_tag_simple_search_idx
  on public.cards using gin (to_tsvector('simple', coalesce(tag, '')));
