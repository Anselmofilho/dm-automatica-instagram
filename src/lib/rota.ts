// Regras fixas que corrigem o classificador nos dois sentidos, depois que ele responde:
// - a guarda derruba para OUTRO tentativa de dar ordem ao robô, proposta comercial e aceite condicional;
// - o atalho promove para envio o "sim" inequívoco que o modelo deixou passar ("simmm", "claroo").
// Os regex saíram de mensagens reais de DM. Antes de "limpar" algum, teste a mudança com
// `npm run classificar -- "mensagem"` contra as respostas que você já recebeu.

const ROTULOS = ['QUER_ACESSO', 'QUER_COM_DUVIDA'];
const COMERCIAL = [
  'UGC', 'PARCERIA', 'PERMUTA', 'PORTFOLIO', 'PORTFÓLIO', 'FREELA', 'ORCAMENTO', 'ORÇAMENTO',
  'DIVULGA', 'COLAB', 'PRESS KIT', 'MEDIA KIT', 'ATACADO', 'REVENDA', 'EMPREGO', 'VAGA', 'CURRICULO', 'CURRÍCULO',
];
const CONDICIONAL = [/\bDEPENDE/, /\bSE FOR\b/, /\bSE TIVER\b/, /\bSE CUSTAR\b/, /\bDEPENDENDO\b/];

function classe(txt: string): string {
  const up = (txt || '').toUpperCase();
  if (ROTULOS.some((r) => up.includes(r))) return 'injecao';
  if (up.includes('<<<') || up.includes('>>>')) return 'injecao';
  if (/IGNOR\w* (AS |TODAS |TODAS AS )?(INSTRU|MENSAGEN)/.test(up)) return 'injecao';
  if (/^SYSTEM\s*:/.test(up)) return 'injecao';
  if (/ESQUE\wA (TUDO|AS INSTRU)/.test(up)) return 'injecao';
  if (COMERCIAL.some((c) => up.includes(c))) return 'comercial';
  if (CONDICIONAL.some((re) => re.test(up))) return 'condicional';
  return '';
}

// Atalho deterministico de aceitacao. So promove OUTRO -> envio; nunca vence a guarda.
const SIM_FORTE = [
  /\bquer[oa]\s+s+i+m+\b/, /\bquero\s+(muito|demais|entrar|participar|sim)\b/,
  /\bqu?ero\s*!+/, /^\s*qu?ero\s*$/, /\beu\s+quero\b/, /\bquero\b/,
  /\b(?:s+i+m+)+\b/, /\bclaro\s+que\s+s+i+m+\b/, /\bobvio\s+que\s+s+i+m+\b/,
  /\badoraria\b/, /\bador+ei\s+a\s+ideia\b/, /\bamaria\b/,
  /\bbora\b/, /\baceito\b/, /\bcom\s+certeza\b/,
  /\bt[oôu]\s+dentro\b/, /\bestou\s+dentro\b/, /\bpode\s+ser\s*!+/,
  /\bpode\s+(mandar|enviar|me\s+mandar|me\s+enviar|sim)\b/,
  /\bmanda\s+(sim|a[ií]|pra\s+mim|pfv|por\s+favor)\b/,
  /\bme\s+(inclui|coloca|adiciona|poe|bota|manda|avisa)\b/,
  /\bquero\s+entrar\s+na\s+lista\b/, /\bquero\s+ver\b/, /\bme\s+chama\b/,
  /\bclaro+\b/, /\bobvio\b/, /\bobv\b/, /\blogico\b/, /\bconta\s+comigo\b/, /\bpartiu\b/, /\bvamo+s?\b/,
  /\bpor\s+favor\b/, /\baham\b/, /\buhum\b/, /\buhul\b/, /\btopo\b/,
  /\bquero\s+ser\b/, /\bt[oôu]\s+na\s+lista\b/, /\bamei\s+a\s+ideia\b/,
  /\bser[ií]a\s+(incr[ií]vel|[oó]tim[oa]|demais|maravilhos[oa]|um\s+prazer|show)\b/,
  /\bvai\s+ser\s+(incr[ií]vel|demais|show|top)\b/,
];
const VETO_ATALHO = [
  /\btrabalh/, /\bcontrat/, /\bvend/, /\bcompr/, /\bfornec/,
  /\bn[ãa]o\b/, /\bnem\b/, /\bmas\b/, /\btalvez\b/, /\bdepois\b/, /\bmais\s+tarde\b/,
  /\bagora\s+n/, /\bpensar\b/, /\bacho\s+que\b/, /\bser[aá]\s+que\b/,
  /\bgolpe\b/, /\bfake\b/, /\bb[oô]t\b/, /\brob[oô]\b/, /\bspam\b/, /\bhacke/, /\bfraude\b/,
  /\bpar[ea]\s+de\b/, /\bchega\b/, /\bbloque/, /\bdenunci/, /\bdescadastr/, /\bdesist/, /\bsair\s+da\s+lista\b/,
  /\bcalma\b/, /\bmais\s+claro\b/, /\bficou\s+claro\b/, /\bt[aá]\s+claro\b/, /\besclarec/, /\bexplic/,
  /\bj[aá]\s+(me\s+)?(cadastr|inscrev|entrei|preenchi|assinei)/, /\bcadastrei\b/, /\bpelo\s+link\s+da\s+bio\b/,
];
const DUVIDA = [
  /\?/, /\bpre[cç]o\b/, /\bvalor\b/, /\bcust/, /\bquanto\b/, /\bquando\b/,
  /\bcomo\s+funciona\b/, /\bdesconto\b/, /\bcupom\b/, /\bfrete\b/,
];

function semAcento(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Vogal e consoante esticadas ("querooo", "certezaa", "SIMMM") sao a forma normal de escrever
// na DM. Comparo nos dois textos: o original normalizado e o colapsado, para nao perder
// nenhum padrao que ja funcionava.
function colapsa(s: string): string {
  return (s || '').replace(/(.)\1+/g, '$1');
}

export type ResultadoRota = {
  rotulo: 'QUER_ACESSO' | 'QUER_COM_DUVIDA' | 'OUTRO';
  bruto: string;
  guarda: string | null;
  atalho: string | null;
};

export function montarRota(labelRaw: string, textoOriginal: string): ResultadoRota {
  const bruto = labelRaw || '';
  const r = bruto.trim().toUpperCase().replace(/[^A-Z_]/g, '');
  let rotulo: ResultadoRota['rotulo'] = r === 'QUER_ACESSO' || r === 'QUER_COM_DUVIDA' ? (r as any) : 'OUTRO';

  const original = textoOriginal || '';
  const norm = semAcento(original).toLowerCase();
  const norm2 = colapsa(norm);
  const casa = (lista: RegExp[]) => lista.some((re) => re.test(norm) || re.test(norm2));
  let atalho: string | null = null;
  if (rotulo === 'OUTRO' && original.length <= 200 && !casa(VETO_ATALHO)) {
    if (casa(SIM_FORTE)) {
      atalho = casa(DUVIDA) ? 'QUER_COM_DUVIDA' : 'QUER_ACESSO';
    }
  }
  if (atalho) rotulo = atalho as ResultadoRota['rotulo'];

  const g = classe(original);
  if (g) rotulo = 'OUTRO';

  return { rotulo, bruto, guarda: g || null, atalho };
}
