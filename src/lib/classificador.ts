import { config, PROMPT_CONVITE, PROMPT_INTENCAO } from '../config.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} ausente`);
  return v;
}

// Uma chamada ao Groq. Qualquer coisa fora do esperado vira erro, nunca um rótulo padrão: é o erro
// que faz o fluxo parar e avisar, em vez de seguir respondendo errado em silêncio.
async function perguntar(prompt: string): Promise<string> {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.modelo,
      temperature: 0,
      // gpt-oss é modelo de raciocínio: gasta tokens pensando antes de responder. Com teto baixo
      // (16, por exemplo) ele devolve resposta vazia, sem erro nenhum.
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  // Modelo aposentado pelo Groq também cai aqui (400/404): o alerta avisa no mesmo dia.
  if (!resp.ok) throw new Error(`Groq respondeu ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 300)}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error('Groq sem conteúdo na resposta');
  return content;
}

// Devolve o texto bruto do modelo; quem decide o rótulo final é montarRota (lib/rota.ts).
export async function classificarIntencao(texto: string): Promise<string> {
  return perguntar(PROMPT_INTENCAO.replace('{{TEXTO}}', texto));
}

// true se a última mensagem que a sua conta mandou para a pessoa foi o convite para a lista.
export async function classificarConvite(texto: string): Promise<boolean> {
  const bruto = await perguntar(PROMPT_CONVITE.replace('{{TEXTO}}', texto));
  return bruto.trim().toUpperCase().replace(/[^A-Z_]/g, '') === 'CONVITE';
}

// Alerta quando o classificador falha: a pessoa respondeu e ninguém respondeu de volta. Sem webhook
// do Discord configurado, o aviso fica só no log.
export async function alertarClassificadorFalhou(params: { senderId: string; texto: string; erro: string }): Promise<void> {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const content =
    `⚠️ **DM automática: o classificador falhou, responda à mão**\n` +
    `IGSID: ${params.senderId}\n` +
    `Texto: ${params.texto}\n` +
    `Erro: ${params.erro}\n` +
    `Quando: ${quando}`;
  const webhookUrl = process.env.DISCORD_ALERTA_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(content);
    return;
  }
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
