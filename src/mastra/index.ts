import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { PostgresStore } from '@mastra/pg';
import { dmAutomaticaWorkflow } from './workflows/dm-automatica.js';

// A mesma URL recebe a verificação do webhook (GET) e os eventos (POST).
const WEBHOOK = '/webhook/instagram';

export const mastra = new Mastra({
  workflows: { dmAutomatica: dmAutomaticaWorkflow },
  // As execuções ficam salvas no Postgres, no schema "mastra". Fora do public de propósito: no Supabase,
  // o public é exposto pela API, e os snapshots guardam o texto das DMs.
  storage: new PostgresStore({ id: 'mastra-storage', connectionString: process.env.DATABASE_URL!, schemaName: 'mastra' }),
  server: {
    middleware: [
      // Sem autenticação, o Mastra deixa pública a API dele em /api/*, que lista as execuções (com o
      // texto das DMs) e dispara workflows. Aqui só o webhook fica aberto; o resto responde 404.
      // PAINEL_ABERTO=true libera tudo para usar o painel do `npm run dev` na sua máquina. Nunca no servidor.
      async (c, next) => {
        if (c.req.path === WEBHOOK || process.env.PAINEL_ABERTO === 'true') return next();
        return c.text('not found', 404);
      },
    ],
    apiRoutes: [
      // Verificação: a Meta chama com hub.verify_token e espera de volta o hub.challenge.
      registerApiRoute(WEBHOOK, {
        method: 'GET',
        handler: async (c) => {
          if (c.req.query('hub.verify_token') === process.env.IG_VERIFY_TOKEN) return c.text(c.req.query('hub.challenge') ?? '');
          return c.text('forbidden', 403);
        },
      }),
      registerApiRoute(WEBHOOK, {
        method: 'POST',
        handler: async (c) => {
          // O corpo cru exato (o que a Meta assinou) e a assinatura, lidos antes de responder.
          // A assinatura é conferida dentro do workflow.
          const rawBody = await c.req.text();
          const sig = c.req.header('x-hub-signature-256') ?? '';

          // A Meta reenvia o evento se não receber 200 rápido: responde já e processa depois.
          void (async () => {
            try {
              const run = await c.get('mastra').getWorkflow('dmAutomatica').createRun();
              await run.start({ inputData: { rawBody, sig } });
            } catch (err) {
              console.error('dm: execução falhou', err);
            }
          })();

          return c.text('EVENT_RECEIVED', 200);
        },
      }),
    ],
  },
});
