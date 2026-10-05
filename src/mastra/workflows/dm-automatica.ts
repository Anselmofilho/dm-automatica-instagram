import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { config, type Rotulo } from '../../config.js';
import { assinaturaConfere, enviarMensagem, montarMensagens } from '../../lib/meta.js';
import { alertarClassificadorFalhou, classificarConvite, classificarIntencao } from '../../lib/classificador.js';
import { montarRota } from '../../lib/rota.js';
import { buscarConvite, gravarLinkEnviado, liberarReserva, registrarConvite, reservarEnvio } from '../../lib/db.js';

// Um envelope só, usado por todos os passos. Cada portão marca `stopped` em vez de encerrar a
// execução, e todo passo seguinte começa com "se já parou, só repassa". Parar é silêncio, não erro.
const Envelope = z
  .object({
    rawBody: z.string(),
    sig: z.string(),
    stopped: z.boolean().default(false),
    reason: z.string().optional(),
    senderId: z.string().default(''),
    text: z.string().default(''),
    textLen: z.number().default(0),
    isEcho: z.boolean().default(false),
    isDeleted: z.boolean().default(false),
    isUnsupported: z.boolean().default(false),
    hasAttachments: z.boolean().default(false),
    mid: z.string().default(''),
    recipientId: z.string().default(''),
    labelRaw: z.string().optional(),
    rotulo: z.string().optional(),
    sendStatus: z.number().optional(),
    // true só entre a reserva do IGSID (portão 2) e um envio de verdade: diz se uma parada no meio
    // do caminho precisa desfazer a reserva.
    reservado: z.boolean().default(false),
  })
  .passthrough();

type EnvelopeT = z.infer<typeof Envelope>;

async function parada(env: EnvelopeT, reason: string): Promise<EnvelopeT> {
  if (env.reservado) await liberarReserva(env.senderId).catch(() => {});
  console.log(`dm: parou (${reason})`);
  return { ...env, stopped: true, reason };
}

// JSON inválido é erro de verdade (falha alto). Assinatura que não confere é silêncio.
const verificarAssinatura = createStep({
  id: 'verificar-assinatura',
  inputSchema: z.object({ rawBody: z.string(), sig: z.string() }),
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    const { rawBody, sig } = inputData;
    if (!rawBody) throw new Error('sem corpo cru');
    if (!sig) throw new Error('sem assinatura');
    JSON.parse(rawBody);

    const base: EnvelopeT = Envelope.parse({ rawBody, sig });
    if (!assinaturaConfere(rawBody, sig)) return await parada(base, 'assinatura não confere');
    return base;
  },
});

// A Meta entrega em dois formatos: entry[].messaging[] (DM real) ou entry[].changes[].value (botão
// de teste do painel). Ler só um deles faz tudo chegar vazio e o portão 1 barrar em silêncio.
const normalizar = createStep({
  id: 'normalizar',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped) return inputData;

    const body = JSON.parse(inputData.rawBody);
    const entry = (Array.isArray(body.entry) && body.entry[0]) || {};

    let m: any = null;
    if (Array.isArray(entry.messaging) && entry.messaging[0]) {
      m = entry.messaging[0];
    } else if (Array.isArray(entry.changes)) {
      const ch = entry.changes.find((c: any) => c && c.field === 'messages' && c.value);
      if (ch) m = ch.value;
    }
    m = m || {};
    const msg = m.message || {};
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';

    return {
      ...inputData,
      senderId: m.sender?.id ? String(m.sender.id) : '',
      text,
      textLen: text.length,
      isEcho: msg.is_echo === true,
      isDeleted: msg.is_deleted === true,
      isUnsupported: msg.is_unsupported === true,
      hasAttachments: Array.isArray(msg.attachments) && msg.attachments.length > 0,
      mid: msg.mid || '',
      // Só vale para eco (is_echo=true): quem recebeu a mensagem que a sua conta mandou.
      recipientId: m.recipient?.id ? String(m.recipient.id) : '',
    };
  },
});

// Toda mensagem que a sua conta manda (você convidando, alguém da equipe atendendo) volta pelo
// webhook como eco. Guarda o texto da mais recente de cada pessoa: o portão 1 confere depois se
// ela foi mesmo o convite. Não para o fluxo aqui; o portão 1 já barra o eco.
const registrarConviteSeEco = createStep({
  id: 'registrar-convite-se-eco',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped) return inputData;
    if (inputData.isEcho && inputData.recipientId) {
      await registrarConvite(inputData.recipientId, inputData.mid || null, inputData.text || null).catch(() => {});
    }
    return inputData;
  },
});

// PORTÃO 1 — "essa mensagem é mesmo para nós?". Segue só se: não é eco, não veio da própria conta,
// é texto de 1 a 200 caracteres, sem anexo, não apagada, E a última mensagem que a sua conta
// mandou para essa pessoa foi o convite. Sem essa última checagem, um "quero" solto em qualquer
// conversa dispara o link.
const portao1 = createStep({
  id: 'portao-1',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped) return inputData;
    const passaBase =
      !inputData.isEcho &&
      inputData.senderId !== '' &&
      inputData.senderId !== process.env.IG_BUSINESS_ACCOUNT_ID &&
      inputData.textLen >= 1 &&
      inputData.textLen <= config.tamanhoMaximo &&
      !inputData.isDeleted &&
      !inputData.isUnsupported &&
      !inputData.hasAttachments;
    if (!passaBase) return await parada(inputData, 'portão 1');

    const convite = await buscarConvite(inputData.senderId);
    if (!convite) return await parada(inputData, 'a pessoa nunca recebeu o convite');
    if (!convite.ultimaMensagem) return await parada(inputData, 'sem o texto da última mensagem enviada');

    let ehConvite: boolean;
    try {
      ehConvite = await classificarConvite(convite.ultimaMensagem);
    } catch {
      return await parada(inputData, 'falha ao conferir se a última mensagem foi o convite');
    }
    if (!ehConvite) return await parada(inputData, 'a última mensagem enviada não foi o convite');

    return inputData;
  },
});

// PORTÃO 2 — "essa pessoa já recebeu o link?". Reserva o IGSID de forma atômica: se duas
// mensagens dela chegam quase juntas, só a primeira passa.
const portao2 = createStep({
  id: 'portao-2',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped) return inputData;
    const reservou = await reservarEnvio(inputData.senderId);
    if (!reservou) return await parada(inputData, 'já recebeu o link');
    return { ...inputData, reservado: true };
  },
});

// "O que essa pessoa quis dizer?". Falha do Groq (rede, cota, modelo aposentado, resposta vazia)
// dispara o alerta e encerra em silêncio: melhor responder à mão do que responder errado.
const classificar = createStep({
  id: 'classificar',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped) return inputData;
    try {
      const labelRaw = await classificarIntencao(inputData.text);
      return { ...inputData, labelRaw };
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      await alertarClassificadorFalhou({ senderId: inputData.senderId, texto: inputData.text, erro }).catch(() => {});
      return await parada(inputData, 'classificador falhou');
    }
  },
});

// PORTÃO 3 — as regras fixas de lib/rota.ts corrigem o rótulo do modelo. OUTRO não segue.
const montarRotaStep = createStep({
  id: 'montar-rota',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped) return inputData;
    const { rotulo, guarda, atalho } = montarRota(inputData.labelRaw || '', inputData.text);
    console.log(`dm: modelo=${(inputData.labelRaw || '').trim()} rotulo=${rotulo} guarda=${guarda ?? '-'} atalho=${atalho ?? '-'}`);
    if (rotulo !== 'QUER_ACESSO' && rotulo !== 'QUER_COM_DUVIDA') return await parada({ ...inputData, rotulo }, 'rótulo OUTRO');
    return { ...inputData, rotulo };
  },
});

const enviarTexto = createStep({
  id: 'enviar-texto',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped || !inputData.rotulo) return inputData;
    const { bodyTexto } = montarMensagens(inputData.rotulo as Rotulo, inputData.senderId);
    await enviarMensagem(bodyTexto);
    return inputData;
  },
});

// O cartão com o botão do link. Só grava "link enviado" se a Meta responder 200: gravar antes
// marcaria como atendida uma pessoa que nunca recebeu nada.
const enviarCartao = createStep({
  id: 'enviar-cartao',
  inputSchema: Envelope,
  outputSchema: Envelope,
  execute: async ({ inputData }) => {
    if (inputData.stopped || !inputData.rotulo) return inputData;
    const { bodyCartao } = montarMensagens(inputData.rotulo as Rotulo, inputData.senderId);
    const resultado = await enviarMensagem(bodyCartao);
    if (resultado.status !== 200) {
      return await parada({ ...inputData, sendStatus: resultado.status }, 'envio do cartão não voltou 200');
    }
    await gravarLinkEnviado(inputData.senderId, inputData.mid || null);
    console.log('dm: link enviado');
    return { ...inputData, sendStatus: resultado.status };
  },
});

export const dmAutomaticaWorkflow = createWorkflow({
  id: 'dm-automatica',
  inputSchema: z.object({ rawBody: z.string(), sig: z.string() }),
  outputSchema: Envelope,
})
  .then(verificarAssinatura)
  .then(normalizar)
  .then(registrarConviteSeEco)
  .then(portao1)
  .then(portao2)
  .then(classificar)
  .then(montarRotaStep)
  // Só espera de verdade se ninguém parou antes: não há por que segurar uma execução encerrada.
  .sleep(async ({ inputData }) => (inputData.stopped ? 0 : config.esperaAntesDoTexto))
  .then(enviarTexto)
  .sleep(async ({ inputData }) => (inputData.stopped ? 0 : config.esperaAntesDoCartao))
  .then(enviarCartao)
  .commit();
