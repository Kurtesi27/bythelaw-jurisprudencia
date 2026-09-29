import axios from 'axios';
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'path';
import type { RawAcordao } from '../data/types';

const urlsPath = path.join(process.cwd(), 'data', 'source_urls.json');
const outputPath = path.join(process.cwd(), 'data', 'raw_acordaos.json');
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const tribunalPorCodigo: Record<string, string> = {
  jstj: 'Supremo Tribunal de Justiça',
  jtrp: 'Tribunal da Relação do Porto',
  jtrl: 'Tribunal da Relação de Lisboa',
  jtrc: 'Tribunal da Relação de Coimbra',
  jtrg: 'Tribunal da Relação de Guimarães',
  jtc: 'Tribunal Central Administrativo',
  jtca: 'Tribunal Central Administrativo',
  jsta: 'Supremo Tribunal Administrativo'
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeHtml(buffer: Buffer): string {
  return new TextDecoder('iso-8859-1').decode(buffer);
}

function getTribunal(url: string): string {
  const hostCode = new URL(url).pathname.split('/')[1]?.split('.')[0]?.toLowerCase();
  return hostCode ? tribunalPorCodigo[hostCode] ?? 'Tribunal não identificado' : 'Tribunal não identificado';
}

async function loadUrls(): Promise<string[]> {
  const configuredUrls: unknown = JSON.parse(await readFile(urlsPath, 'utf-8'));
  if (!Array.isArray(configuredUrls) || !configuredUrls.every((url) => typeof url === 'string')) {
    throw new Error(`${urlsPath} deve conter um array JSON de URLs.`);
  }

  const urls = configuredUrls.map((url) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`URL inválido em ${urlsPath}: ${url}`);
    }

    if (!['dgsi.pt', 'www.dgsi.pt'].includes(parsedUrl.hostname.toLowerCase())) {
      throw new Error(`Apenas URLs de dgsi.pt são permitidos: ${url}`);
    }
    return parsedUrl.toString();
  });

  if (urls.length === 0) {
    throw new Error(`Adicione URLs de acórdãos a ${urlsPath} antes de executar o scraper.`);
  }
  return urls;
}

async function extrairAcordao(url: string): Promise<RawAcordao | null> {
  try {
    console.log(`A extrair: ${url}`);
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer', // O dgsi usa ISO-8859-1 (Latin1) muitas vezes
      headers: {
        'User-Agent': userAgent
      },
      timeout: 20_000
    });

    const html = decodeHtml(Buffer.from(response.data));
    const $ = cheerio.load(html);

    let processo = '';
    let dataAcordao = '';
    let relator = '';
    let sumario = '';
    const regexProcesso = /Processo\s*:/i;
    const regexData = /Data\s+do\s+Acord[aã]o\s*:/i;
    const regexRelator = /Relator\s*:/i;
    const regexSumario = /Sum[aá]rio\s*:/i;

    $('table tr').each((_, element) => {
      const cells = $(element).find('td').toArray().map((cell) => $(cell).text().trim());
      const getValue = (labelPattern: RegExp): string => {
        const labelIndex = cells.findIndex((cell) => labelPattern.test(cell));
        if (labelIndex === -1) return '';

        const labelCell = cells[labelIndex];
        const valueInLabelCell = labelCell.replace(labelPattern, '').trim();
        return valueInLabelCell || cells.slice(labelIndex + 1).find(Boolean) || '';
      };

      processo ||= getValue(regexProcesso);
      dataAcordao ||= getValue(regexData);
      relator ||= getValue(regexRelator);
      sumario ||= getValue(regexSumario);
    });

    $('script, style, noscript').remove();
    const bodyText = $('body').text();
    const textoIntegral = bodyText.replace(/\s+/g, ' ').trim();

    processo ||= bodyText.match(/Processo:\s*([^\s\r\n]+)/i)?.[1] ?? '';
    dataAcordao ||= bodyText.match(/Data\s+do\s+Acord[aã]o\s*:\s*([^\s\r\n]+)/i)?.[1] ?? '';
    relator ||= bodyText.match(/Relator\s*:\s*([^\r\n]+?)(?=\s+(?:Descritores|Data\s+do\s+Acord[aã]o)\s*:|$)/i)?.[1]?.trim() ?? '';
    sumario ||= bodyText.match(
      /Sum[aá]rio\s*:\s*([\s\S]*?)(?=Decis[aã]o\s+Texto\s+Integral|Texto\s+Integral)/i
    )?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

    return {
      id: createHash('sha256').update(url).digest('hex').slice(0, 16),
      url,
      tribunal: getTribunal(url),
      data: dataAcordao,
      processo,
      relator,
      sumario: sumario || 'Sem sumário disponível',
      textoIntegral: textoIntegral.slice(0, 8000)
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const reason = status ? `HTTP ${status}` : error.code ?? error.message;
      console.error(`Falha ao obter ${url}: ${reason}`);
    } else {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Falha ao processar ${url}: ${reason}`);
    }
    return null;
  }
}

async function main() {
  const urlsParaScrape = await loadUrls();
  const delayMilliseconds = Number(process.env.SCRAPE_DELAY_MS ?? 1500);
  if (!Number.isInteger(delayMilliseconds) || delayMilliseconds < 0) {
    throw new Error('SCRAPE_DELAY_MS deve ser um inteiro maior ou igual a zero.');
  }

  const resultados: RawAcordao[] = [];
  const urlsComFalha: string[] = [];

  for (const [index, url] of urlsParaScrape.entries()) {
    const acordao = await extrairAcordao(url);
    if (acordao) {
      resultados.push(acordao);
    } else {
      urlsComFalha.push(url);
    }
    if (index < urlsParaScrape.length - 1) await delay(delayMilliseconds);
  }

  if (resultados.length === 0) {
    throw new Error('Nenhum acórdão foi obtido; o ficheiro existente foi preservado. Confirme os URLs no DGSI.');
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(resultados, null, 2), 'utf-8');
  console.log(`\nConcluído! ${resultados.length} acórdãos gravados em ${outputPath}`);
  if (urlsComFalha.length > 0) {
    console.error(`${urlsComFalha.length} de ${urlsParaScrape.length} URLs falharam; verifique as mensagens acima.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha no scraper: ${message}`);
  process.exitCode = 1;
});