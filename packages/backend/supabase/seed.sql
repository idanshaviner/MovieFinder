-- seed.sql — local dev seed. Real catalog comes from the ingest job (E1).
-- A couple of titles so /recommend has something to retrieve locally before ingest runs.
-- (Embeddings intentionally omitted here; insert via the ingest job which calls OpenAI.)

insert into catalog_titles (tmdb_id, media_type, title, release_year, genres, overview, adult, providers)
values
  (27205, 'movie', 'Inception', 2010, '{Action,Science Fiction,Thriller}',
   'A thief who steals corporate secrets through dream-sharing technology.', false,
   '{"US": ["Netflix"]}'),
  (1124, 'movie', 'The Prestige', 2006, '{Drama,Mystery,Thriller}',
   'Two rival magicians engage in a battle to create the ultimate illusion.', false,
   '{"US": ["Netflix"]}')
on conflict (tmdb_id) do nothing;
