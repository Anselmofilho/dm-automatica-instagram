import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, type Rotulo } from '../config.js';

// Versão da Graph API. A Meta aposenta versões antigas; se as chamadas começarem a falhar com
// "version deprecated", suba o número aqui.
const GRAPH = 'https://graph.instagram.com/v26.0';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} ausente`);
  return v;
}

// A Meta assina cada evento com o app secret (header x-hub-signature-256). Sem essa conferência,
// qualquer um que descubra a URL do webhook consegue fazer o fluxo mandar DM.
export function assinaturaConfere(rawBody: string, sig: string): boolean {
  const esperado = `sha256=${createHmac('sha256', requireEnv('IG_APP_SECRET')).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(esperado);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EnvioResultado = { status: number; messageId: string | null };

// Com MODO_SIMULACAO=true nada sai pela Graph API: o fluxo inteiro roda com as credenciais reais,
// avisa o que teria mandado e para quem (Discord, ou o console se não houver webhook) e devolve um
// sucesso de mentira para o resto seguir igual (dedupe, logs). É assim que se testa sem risco.
const MODO_SIMULACAO = process.env.MODO_SIMULACAO === 'true';

export async function enviarMensagem(body: unknown): Promise<EnvioResultado> {
  if (MODO_SIMULACAO) {
    await avisarSimulacao(body);
    return { status: 200, messageId: 'simulado' };
  }

  const resp = await fetch(`${GRAPH}/${requireEnv('IG_BUSINESS_ACCOUNT_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('IG_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (resp.status !== 200) console.error('envio: Graph API respondeu', resp.status, JSON.stringify(data?.error ?? data));
  return { status: resp.status, messageId: data?.message_id ?? null };
}

async function avisarSimulacao(body: unknown): Promise<void> {
  const resumo = JSON.stringify(body, null, 2);
  console.log('[MODO SIMULACAO] mandaria esta mensagem:', resumo);

  const webhookUrl = process.env.DISCORD_ALERTA_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🧪 **MODO SIMULAÇÃO** — a mensagem NÃO foi enviada. Isto é o que seria mandado:\n\`\`\`json\n${resumo}\n\`\`\`` }),
    });
  } catch (err) {
    console.error('[MODO SIMULACAO] falhou ao avisar no Discord', err);
  }
}

// As duas mensagens de um rótulo: o texto curto e o cartão com o botão do link.
export function montarMensagens(rotulo: Rotulo, igsid: string) {
  const { texto, cartao, campanha } = config.mensagens[rotulo];
  const url = config.link(campanha, igsid);
  const bodyTexto = { recipient: { id: igsid }, message: { text: texto } };
  const bodyCartao = {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: cartao,
          buttons: [{ type: 'web_url', url, title: config.botao }],
        },
      },
    },
  };
  return { bodyTexto, bodyCartao, url };
}
