import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

// Reserva atômica do IGSID: o INSERT com "on conflict do nothing" deixa só uma execução passar
// quando duas mensagens da mesma pessoa chegam quase juntas. Um SELECT antes do envio não basta:
// as duas leriam "ainda não recebeu" e o link sairia em dobro.
export async function reservarEnvio(igsid: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'insert into dm_contatos (igsid, link_enviado) values ($1, false) on conflict (igsid) do nothing',
    [igsid],
  );
  return (rowCount ?? 0) > 0;
}

// Desfaz uma reserva que não virou envio (o fluxo parou depois de reservar, ou o envio falhou).
// Sem isso, a pessoa ficaria bloqueada para sempre sem nunca ter recebido o link.
export async function liberarReserva(igsid: string): Promise<void> {
  await getPool().query('delete from dm_contatos where igsid = $1 and link_enviado = false', [igsid]);
}

export async function gravarLinkEnviado(igsid: string, mid: string | null): Promise<void> {
  await getPool().query(
    `insert into dm_contatos (igsid, link_enviado, data_link, mid)
     values ($1, true, now(), $2)
     on conflict (igsid) do update set link_enviado = true, data_link = now(), mid = excluded.mid`,
    [igsid, mid],
  );
}

// O texto da última mensagem que a SUA conta mandou para essa pessoa (capturado pelo eco do
// webhook). Serve para conferir se foi mesmo o convite, e não uma conversa de atendimento.
export async function buscarConvite(igsid: string): Promise<{ ultimaMensagem: string | null } | null> {
  const { rows } = await getPool().query('select ultima_mensagem from convites_enviados where igsid = $1', [igsid]);
  if (!rows.length) return null;
  return { ultimaMensagem: rows[0].ultima_mensagem };
}

export async function registrarConvite(igsid: string, mid: string | null, texto: string | null): Promise<void> {
  await getPool().query(
    `insert into convites_enviados (igsid, mid, ultima_mensagem)
     values ($1, $2, $3)
     on conflict (igsid) do update set data_convite = now(), mid = excluded.mid, ultima_mensagem = excluded.ultima_mensagem`,
    [igsid, mid, texto],
  );
}
