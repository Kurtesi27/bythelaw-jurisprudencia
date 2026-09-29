import { GoogleGenAI } from '@google/genai';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { DivergenciaInfo, ProcessedAcordao, RawAcordao } from '../data/types';

const inputPath = path.join(process.cwd(), 'data', 'raw_acordaos.json');
const outputPath = path.join(process.cwd(), 'data', 'processed_data.json');

interface LlmAnalysis {
  areaDireito: string;
  temaPrincipal: string;
  sumarioExecutivo: string;
  teseJuridica: string;
  decisao: ProcessedAcordao['decisao'];
  divergencia: DivergenciaInfo & { tribunaisEmConflito: string[] };
}

const analysisSchema = {
  type: 'object',
  properties: {
    areaDireito: { type: 'string' },
    temaPrincipal: { type: 'string' },
    sumarioExecutivo: { type: 'string' },
    teseJuridica: { type: 'string' },
    decisao: { type: 'string', enum: ['Concedido', 'Negado', 'Anulado', 'Outro'] },
    divergencia: {
      type: 'object',
      properties: {
        existeDivergencia: { type: 'boolean' },
        temaConflito: { type: 'string' },
        posicaoAdotada: { type: 'string' },
        tribunaisEmConflito: { type: 'array', items: { type: 'string' } },
        fundamentacaoDivergencia: { type: 'string' }
      },
      required: [
        'existeDivergencia',
        'temaConflito',
        'posicaoAdotada',
        'tribunaisEmConflito',
        'fundamentacaoDivergencia'
      ],
      additionalProperties: false
    }
  },
  required: ['areaDireito', 'temaPrincipal', 'sumarioExecutivo', 'teseJuridica', 'decisao', 'divergencia'],
  additionalProperties: false
};

const divergenceSchema = {
  type: 'object',
  properties: {
    existeDivergencia: { type: 'boolean' },
    temaConflito: { type: 'string' },
    posicaoAdotada: { type: 'string' },
    tribunaisEmConflito: { type: 'array', items: { type: 'string' } },
    fundamentacaoDivergencia: { type: 'string' }
  },
  required: [
    'existeDivergencia',
    'temaConflito',
    'posicaoAdotada',
    'tribunaisEmConflito',
    'fundamentacaoDivergencia'
  ],
  additionalProperties: false
};

const clusterComparisonSchema = {
  type: 'object',
  properties: {
    divergencia: divergenceSchema,
    idsEmConflito: { type: 'array', items: { type: 'string' } }
  },
  required: ['divergencia', 'idsEmConflito'],
  additionalProperties: false
};

interface LlmClusterComparison {
  divergencia: LlmAnalysis['divergencia'];
  idsEmConflito: string[];
}

function isRawAcordao(value: unknown): value is RawAcordao {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['id', 'url', 'tribunal', 'data', 'processo', 'relator', 'sumario', 'textoIntegral']
    .every((key) => typeof record[key] === 'string');
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isLlmAnalysis(value: unknown): value is LlmAnalysis {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const divergence = record.divergencia;
  if (typeof divergence !== 'object' || divergence === null) return false;

  const divergenceRecord = divergence as Record<string, unknown>;
  return typeof record.areaDireito === 'string'
    && typeof record.temaPrincipal === 'string'
    && typeof record.sumarioExecutivo === 'string'
    && typeof record.teseJuridica === 'string'
    && ['Concedido', 'Negado', 'Anulado', 'Outro'].includes(String(record.decisao))
    && typeof divergenceRecord.existeDivergencia === 'boolean'
    && typeof divergenceRecord.temaConflito === 'string'
    && typeof divergenceRecord.posicaoAdotada === 'string'
    && Array.isArray(divergenceRecord.tribunaisEmConflito)
    && divergenceRecord.tribunaisEmConflito.every((court) => typeof court === 'string')
    && typeof divergenceRecord.fundamentacaoDivergencia === 'string';
}

function isLlmDivergence(value: unknown): value is LlmAnalysis['divergencia'] {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.existeDivergencia === 'boolean'
    && typeof record.temaConflito === 'string'
    && typeof record.posicaoAdotada === 'string'
    && Array.isArray(record.tribunaisEmConflito)
    && record.tribunaisEmConflito.every((court) => typeof court === 'string')
    && typeof record.fundamentacaoDivergencia === 'string';
}

function isLlmClusterComparison(value: unknown): value is LlmClusterComparison {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isLlmDivergence(record.divergencia)
    && Array.isArray(record.idsEmConflito)
    && record.idsEmConflito.every((id) => typeof id === 'string');
}

function loadLocalEnvironment(): void {
  const localEnvironmentPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(localEnvironmentPath)) return;

  try {
    process.loadEnvFile(localEnvironmentPath);
  } catch {
    console.warn('Não foi possível ler .env.local; a análise continuará com fallback local se não houver chave no ambiente.');
  }
}

function getYear(acordao: RawAcordao): number {
  const year = acordao.data.match(/\b(?:19|20)\d{2}\b/)?.[0];
  if (!year) throw new Error(`Não foi possível obter o ano da data "${acordao.data}" (${acordao.url}).`);
  return Number(year);
}

function getSummary(acordao: RawAcordao): string {
  const savedSummary = acordao.sumario.trim();
  if (savedSummary && !/^sem sum[aá]rio dispon[ií]vel$/i.test(savedSummary)) return savedSummary;

  return acordao.textoIntegral.match(
    /Sum[aá]rio\s*:\s*([\s\S]*?)(?=Decis[aã]o\s+Texto\s+Integral|Texto\s+Integral)/i
  )?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

function identifyArea(text: string): string {
  const normalized = normalize(text);
  if (/direito do trabalho|despedimento|contrato de trabalho|relacao laboral|controlo patronal|fiscalizacao patronal|justa causa de despedimento/.test(normalized)) {
    return 'Direito do Trabalho';
  }
  if (/processo penal|codigo de processo penal|\bcpp\b|arguido|extradicao|crime|pena de prisao/.test(normalized)) {
    return 'Direito Penal e Processual Penal';
  }
  if (/direito constitucional|constituicao da republica|\bcrp\b|inconstitucionalidade/.test(normalized)) {
    return 'Direito Constitucional';
  }
  if (/codigo civil|\bcpc\b|empreitada|responsabilidade civil|contrato|obrigacao|indemnizacao/.test(normalized)) {
    return 'Direito Civil';
  }
  if (/direito administrativo|codigo de procedimento administrativo|\bcpta\b|\birc\b/.test(normalized)) {
    return 'Direito Administrativo';
  }
  return 'Área não identificada automaticamente';
}

function identifyTopic(text: string, areaDireito: string): string {
  const normalized = normalize(text);
  if (/despedimento|controlo patronal|fiscalizacao patronal|vigilancia patronal/.test(normalized)) {
    return 'Fiscalização patronal de comunicações e despedimento';
  }
  if (/pecas processuais|atos processuais escritos|apresentacao a juizo|remessa a juizo/.test(normalized)
    && /correio electronico|correio-eletronico|mensagem de correio|\bemail\b/.test(normalized)) {
    return 'Apresentação de atos processuais por correio eletrónico';
  }
  if (/encrochat|sky ecc|correio eletronico|comunicacoes eletronicas|prova digital/.test(normalized)) {
    return 'Admissibilidade e obtenção de prova digital';
  }
  if (/extradicao|mandado de detencao europeu/.test(normalized)) {
    return 'Extradição e cooperação judiciária internacional';
  }
  if (/inimputabilidade|pericia psiquiatrica|anomalia psiquica/.test(normalized)) {
    return 'Inimputabilidade e prova pericial';
  }
  if (/empreitada|defeito(?:s)? de construcao|garantia bancaria/.test(normalized)) {
    return 'Contrato de empreitada e responsabilidade por defeitos';
  }
  if (/apreensao|intercecao|interce[pç][aã]o|comunicacoes/.test(normalized)) {
    return 'Obtenção e admissibilidade de prova';
  }
  return `Questão jurídica em ${areaDireito.toLowerCase()}`;
}

function mapDecision(text: string): ProcessedAcordao['decisao'] {
  const decisionLabel = text.match(
    /Decis[aã]o\s*:\s*([\s\S]*?)(?=\s+(?:Sum[aá]rio|Texto Integral|Privacidade|Meio Processual)\s*:|$)/i
  )?.[1];
  const decisionText = normalize(decisionLabel || text);

  if (/anulad|anulac/.test(decisionText)) return 'Anulado';
  if (/revogad|reformad/.test(decisionText)) return 'Concedido';
  if (/confirmad/.test(decisionText)) return 'Negado';
  if (/concedid|provido|procedente|deferid|autorizad/.test(decisionText)) return 'Concedido';
  if (/negad|improcedente|desprovid|indeferid|nao autorizar|recusad/.test(decisionText)) return 'Negado';
  return 'Outro';
}

function extractThesis(summary: string): string {
  if (!summary) return 'Não foi possível extrair uma tese do sumário; requer análise jurídica manual.';
  return summary.trim();
}

function emptyDivergenceInfo(topic: string): DivergenciaInfo {
  return {
    existeDivergencia: false,
    temaConflito: topic,
    posicaoAdotada: '',
    tribunaisEmConflito: [],
    fundamentacaoDivergencia: ''
  };
}

function processAcordao(acordao: RawAcordao): ProcessedAcordao {
  const summary = getSummary(acordao);
  const teseJuridica = extractThesis(summary);
  const sourceText = `${summary}\n${acordao.textoIntegral}`;
  const areaDireito = identifyArea(sourceText);
  const temaPrincipal = identifyTopic(sourceText, areaDireito);
  const decisao = mapDecision(acordao.textoIntegral || summary);
  const sumarioExecutivo = summary
    ? `O acórdão aprecia ${temaPrincipal.toLowerCase()}. O resultado foi classificado como «${decisao}»; o sumário indica: ${summary}`
    : `O acórdão aprecia ${temaPrincipal.toLowerCase()} e o resultado foi classificado como «${decisao}». Não foi encontrado sumário, pelo que a síntese requer validação manual.`;

  return {
    id: acordao.id,
    processo: acordao.processo,
    data: acordao.data,
    ano: getYear(acordao),
    tribunal: acordao.tribunal,
    relator: acordao.relator,
    url: acordao.url,
    areaDireito,
    temaPrincipal,
    sumarioExecutivo,
    teseJuridica,
    decisao,
    divergencia: emptyDivergenceInfo(temaPrincipal)
  };
}

async function requestLlmAnalysis(client: GoogleGenAI, acordao: RawAcordao): Promise<LlmAnalysis> {
  const prompt = [
    'És um assistente de análise jurídica portuguesa. Analisa apenas o acórdão fornecido; não inventes factos, normas, resultados ou conflitos jurisprudenciais.',
    'Devolve exclusivamente um objeto JSON válido, sem Markdown nem texto fora do JSON, com todos os campos do schema.',
    'O sumarioExecutivo deve resumir a questão discutida e o resultado. A teseJuridica deve descrever o critério jurídico efetivamente adotado.',
    'Nesta análise individual, devolve divergencia com existeDivergencia=false e strings/lista vazias. A divergência só será decidida numa comparação posterior entre acórdãos do mesmo tema.',
    'A decisão tem de ser exatamente uma destas opções: Concedido, Negado, Anulado, Outro.',
    'ACÓRDÃO:',
    JSON.stringify({
      processo: acordao.processo,
      data: acordao.data,
      tribunal: acordao.tribunal,
      relator: acordao.relator,
      sumario: acordao.sumario,
      textoIntegral: acordao.textoIntegral.slice(0, 28_000)
    })
  ].join('\n\n');

  const response = await client.models.generateContent({
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: analysisSchema,
      temperature: 0.1,
      maxOutputTokens: 2400
    }
  });

  const responseText = response.text;
  if (!responseText) throw new Error('A resposta do Gemini não contém texto JSON.');

  const result: unknown = JSON.parse(responseText);
  if (!isLlmAnalysis(result)) throw new Error('A resposta do Gemini não respeita o schema esperado.');
  return result;
}

async function requestClusterComparison(
  client: GoogleGenAI,
  cluster: ProcessedAcordao[]
): Promise<LlmClusterComparison> {
  const response = await client.models.generateContent({
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    contents: [
      'És um auditor de jurisprudência portuguesa. Compara apenas os acórdãos do mesmo cluster abaixo.',
      'Pergunta obrigatória: "Existe contradição direta entre as decisões ou teses jurídicas fixadas nestes acórdãos ao longo do tempo ou entre instâncias?"',
      'Não infiras divergência por palavras-chave, por mera citação de outra decisão, nem por uma diferença explicável por factos ou normas diferentes. Exige posições jurídicas incompatíveis sobre a mesma questão.',
      'Se existir, devolve idsEmConflito com os ids exatos dos acórdãos que sustentam os entendimentos opostos; a fundamentação deve identificar os processos, anos, tribunais e posições. Só indica em tribunaisEmConflito tribunais presentes no cluster. Se não existir contradição direta, usa existeDivergencia=false e idsEmConflito=[].',
      'Devolve exclusivamente JSON conforme ao schema.',
      'ACÓRDÃOS DO CLUSTER:',
      JSON.stringify(cluster.map((acordao) => ({
        id: acordao.id,
        processo: acordao.processo,
        ano: acordao.ano,
        tribunal: acordao.tribunal,
        areaDireito: acordao.areaDireito,
        temaPrincipal: acordao.temaPrincipal,
        decisao: acordao.decisao,
        sumarioExecutivo: acordao.sumarioExecutivo,
        teseJuridica: acordao.teseJuridica
      })))
    ].join('\n\n'),
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: clusterComparisonSchema,
      temperature: 0.1,
      maxOutputTokens: 1800
    }
  });

  if (!response.text) throw new Error('A comparação Gemini não contém texto JSON.');
  const result: unknown = JSON.parse(response.text);
  if (!isLlmClusterComparison(result)) throw new Error('A comparação Gemini não respeita o schema esperado.');
  return result;
}

function groupIndexesByTopic(acordaos: ProcessedAcordao[]): number[][] {
  const groups = new Map<string, number[]>();
  acordaos.forEach((acordao, index) => {
    const area = normalize(acordao.areaDireito);
    const topic = normalize(acordao.temaPrincipal);
    if (!area || !topic || topic.startsWith('questao juridica em ')) return;

    const key = `${area}|${topic}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()].filter((indexes) => indexes.length > 1);
}

function createFallbackClusterResult(cluster: ProcessedAcordao[]): {
  divergence: DivergenciaInfo;
  idsEmConflito: string[];
} {
  const concedidos = cluster.filter((acordao) => acordao.decisao === 'Concedido');
  const negados = cluster.filter((acordao) => acordao.decisao === 'Negado');
  const concedido = concedidos[0];
  const negado = negados[0];

  if (!concedido || !negado) {
    return { divergence: emptyDivergenceInfo(cluster[0]?.temaPrincipal ?? ''), idsEmConflito: [] };
  }

  const courts = [...new Set([concedido.tribunal, negado.tribunal].filter(Boolean))];
  const position = `${concedido.processo} (${concedido.ano}, ${concedido.tribunal}): Concedido; ${negado.processo} (${negado.ano}, ${negado.tribunal}): Negado.`;
  return {
    divergence: {
      existeDivergencia: true,
      temaConflito: concedido.temaPrincipal,
      posicaoAdotada: position,
      tribunaisEmConflito: courts,
      fundamentacaoDivergencia: `Comparação heurística de decisões opostas no mesmo tema: ${position} É necessária revisão das teses e dos fundamentos antes de concluir que existe contradição jurídica direta.`
    },
    idsEmConflito: [...new Set([...concedidos, ...negados].map((acordao) => acordao.id))]
  };
}

function constrainComparisonToCluster(
  comparison: LlmClusterComparison,
  cluster: ProcessedAcordao[]
): { divergence: DivergenciaInfo; idsEmConflito: string[] } {
  if (!comparison.divergencia.existeDivergencia) {
    return {
      divergence: {
        ...comparison.divergencia,
        tribunaisEmConflito: []
      },
      idsEmConflito: []
    };
  }

  const clusterIds = new Set(cluster.map((acordao) => acordao.id));
  const idsEmConflito = [...new Set(comparison.idsEmConflito.filter((id) => clusterIds.has(id)))];
  if (idsEmConflito.length < 2) {
    throw new Error('A comparação assinalou divergência sem pelo menos dois acórdãos do cluster.');
  }

  const implicatedCourts = new Set(cluster
    .filter((acordao) => idsEmConflito.includes(acordao.id))
    .map((acordao) => acordao.tribunal)
    .filter(Boolean));
  const tribunaisEmConflito = comparison.divergencia.tribunaisEmConflito
    .filter((court) => implicatedCourts.has(court));

  return {
    divergence: {
      ...comparison.divergencia,
      tribunaisEmConflito: tribunaisEmConflito.length > 0 ? tribunaisEmConflito : [...implicatedCourts]
    },
    idsEmConflito
  };
}

function applyClusterResults(
  processed: ProcessedAcordao[],
  clusterIndexes: number[],
  base: ProcessedAcordao[],
  result: { divergence: DivergenciaInfo; idsEmConflito: string[] }
): void {
  const idsInConflict = new Set(result.idsEmConflito);
  for (const index of clusterIndexes) {
    processed[index] = {
      ...processed[index],
      divergencia: idsInConflict.has(processed[index].id)
        ? result.divergence
        : emptyDivergenceInfo(base[index].temaPrincipal)
    };
  }
}

function applyLlmAnalysis(base: ProcessedAcordao, llm: LlmAnalysis): ProcessedAcordao {
  return {
    ...base,
    areaDireito: llm.areaDireito,
    temaPrincipal: llm.temaPrincipal,
    sumarioExecutivo: llm.sumarioExecutivo,
    teseJuridica: llm.teseJuridica,
    decisao: llm.decisao,
    divergencia: base.divergencia
  };
}

function describeLlmFailure(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? `HTTP ${error.status}: `
    : '';
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  const safeMessage = message
    .replace(/AIza[\w-]{20,}/g, '[chave redigida]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[chave redigida]')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  return `${status}${safeMessage}`;
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const input: unknown = JSON.parse(await readFile(inputPath, 'utf-8'));
  if (!Array.isArray(input) || !input.every(isRawAcordao)) {
    throw new Error(`${inputPath} tem de conter um array de acórdãos com todos os campos RawAcordao.`);
  }
  if (input.length === 0) throw new Error('O ficheiro de acórdãos está vazio; não foi alterado o ficheiro processado.');

  const forceLocal = process.env.ANALYZE_FORCE_LOCAL === '1';
  const apiKey = forceLocal ? '' : process.env.GEMINI_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();
  const client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  let llmAvailable = Boolean(client);
  if (forceLocal) console.warn('ANALYZE_FORCE_LOCAL=1; será usada apenas a análise heurística local.');
  else if (!client) console.warn('Sem GEMINI_API_KEY ou LLM_API_KEY; será usada a análise heurística local.');

  const base: ProcessedAcordao[] = input.map(processAcordao);
  const processed: ProcessedAcordao[] = [...base];
  if (client) {
    for (const [index, acordao] of input.entries()) {
      if (!llmAvailable) continue;

      try {
        const llmAnalysis = await requestLlmAnalysis(client, acordao);
        processed[index] = applyLlmAnalysis(base[index], llmAnalysis);
      } catch (error) {
        llmAvailable = false;
        console.warn(`Gemini indisponível (${describeLlmFailure(error)}); a análise restante usará o fallback local.`);
      }
    }
  }

  let clusterLlmAvailable = Boolean(client) && llmAvailable;
  for (const clusterIndexes of groupIndexesByTopic(base)) {
    const baseCluster = clusterIndexes.map((index) => base[index]);
    let result: { divergence: DivergenciaInfo; idsEmConflito: string[] };

    if (client && clusterLlmAvailable) {
      const comparisonCluster = clusterIndexes.map((index) => ({
        ...processed[index],
        areaDireito: base[index].areaDireito,
        temaPrincipal: base[index].temaPrincipal
      }));
      try {
        const comparison = await requestClusterComparison(client, comparisonCluster);
        result = constrainComparisonToCluster(comparison, comparisonCluster);
      } catch (error) {
        clusterLlmAvailable = false;
        console.warn(`Comparação Gemini indisponível (${describeLlmFailure(error)}); os clusters restantes usarão fallback local.`);
        result = createFallbackClusterResult(baseCluster);
      }
    } else {
      result = createFallbackClusterResult(baseCluster);
    }

    applyClusterResults(processed, clusterIndexes, base, result);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(processed, null, 2), 'utf-8');
  console.log(`Concluído: ${processed.length} acórdãos processados em ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha na análise: ${message}`);
  process.exitCode = 1;
});