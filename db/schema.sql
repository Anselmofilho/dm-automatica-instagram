-- Rode uma vez no seu Postgres (no Supabase: SQL Editor > New query > cole e clique em Run).
-- As tabelas internas do Mastra (mastra_*) são criadas sozinhas na primeira vez que o servidor sobe.

-- Quem já recebeu o link. É o portão 2 do fluxo: ninguém recebe duas vezes.
create table if not exists dm_contatos (
  igsid text primary key,
  link_enviado boolean not null default false,
  data_link timestamptz,
  mid text
);

-- A última mensagem que a sua conta mandou para cada pessoa, capturada pelo eco do webhook.
-- O portão 1 só deixa passar quem recebeu o convite: sem isso, um "quero" solto em qualquer
-- conversa (atendimento, dúvida de produto) dispararia o link.
create table if not exists convites_enviados (
  igsid text primary key,
  data_convite timestamptz not null default now(),
  mid text,
  ultima_mensagem text
);

-- No Supabase, estas tabelas ficam no schema public, que a API do Supabase expõe. Com RLS ligado e
-- nenhuma policy, só a conexão direta (DATABASE_URL) lê e escreve nelas.
alter table dm_contatos enable row level security;
alter table convites_enviados enable row level security;
