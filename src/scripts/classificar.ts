// Testa mensagens no classificador sem Meta e sem banco: mostra o que o modelo respondeu e o
// rótulo final, depois das regras fixas de lib/rota.ts. Só precisa do GROQ_API_KEY no .env.
// Uso: npm run classificar -- "quero sim" "quanto custa?" "simmm"
import { classificarIntencao } from '../lib/classificador.js';
import { montarRota } from '../lib/rota.js';

const textos = process.argv.slice(2);
if (!textos.length) {
  console.error('Uso: npm run classificar -- "mensagem" ["outra mensagem" ...]');
  process.exit(1);
}

for (const texto of textos) {
  const bruto = await classificarIntencao(texto);
  const { rotulo, guarda, atalho } = montarRota(bruto, texto);
  const detalhes = [`modelo: ${bruto.trim()}`, guarda && `guarda: ${guarda}`, atalho && `atalho: ${atalho}`].filter(Boolean).join(', ');
  console.log(`${rotulo.padEnd(16)} ${JSON.stringify(texto)}  (${detalhes})`);
}
