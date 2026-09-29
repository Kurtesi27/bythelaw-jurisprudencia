# ByTheLaw Jurisprudência

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/) [![Google GenAI SDK](https://img.shields.io/badge/Google_GenAI-SDK-4285F4?logo=google&logoColor=white)](https://github.com/googleapis/js-genai)

**Protótipo técnico de análise de jurisprudência portuguesa do DGSI**, desenvolvido para um desafio de contratação da ByTheLaw.

| Aplicação | Código-fonte |
| --- | --- |
| [Abrir aplicação na Vercel](https://bythelaw-jurisprudencia.vercel.app) | [Ver repositório no GitHub](https://github.com/Kurtesi27/bythelaw-jurisprudencia) |

## Visão geral

A pesquisa no DGSI exige que advogados e investigadores encontrem decisões em diferentes páginas, tribunais e períodos, e depois comparem manualmente os respetivos fundamentos. Essa fragmentação torna mais difícil identificar a evolução de um entendimento ou localizar decisões potencialmente contraditórias.

Este protótipo reúne acórdãos selecionados do DGSI, organiza-os por área e tema, produz sumários executivos e teses jurídicas e permite pesquisar e filtrar o corpus. A análise de divergências compara acórdãos do mesmo tema e período, procurando diferenças de entendimento entre decisões.

A ferramenta é experimental: classificações e divergências devem ser verificadas na fonte oficial e não substituem análise jurídica.

## Arquitetura e decisões de engenharia

A recolha e a análise são executadas localmente e de forma independente da interface:

```text
data/source_urls.json
				│
				▼
scripts/scrape.ts ──► data/raw_acordaos.json
														│
														▼
										 scripts/analyze.ts
											├─ Google GenAI
											└─ fallback local
														│
														▼
									 data/processed_data.json
														│
														▼
									 app/page.tsx (dashboard)
```

### Recolha responsável

`scripts/scrape.ts` lê URLs diretos configurados em `data/source_urls.json` e consulta-os sequencialmente com Axios e Cheerio. Usa um intervalo padrão de 1.500 ms entre pedidos, configurável através de `SCRAPE_DELAY_MS`, e um timeout por pedido.

As falhas são registadas sem interromper os restantes URLs. Se nenhum acórdão for obtido, o ficheiro de saída existente é preservado. O scraper não tenta contornar respostas do DGSI nem implementa repetição automática de pedidos rejeitados.

### Análise com LLM e fallback

`scripts/analyze.ts` extrai os metadados dos acórdãos e, quando configurado, usa o SDK oficial `@google/genai` para produzir dados estruturados e comparar decisões agrupadas por área e tema.

Se a API estiver indisponível, exceder a quota (`HTTP 429`), devolver erro de serviço (`HTTP 503`) ou uma resposta inválida, o pipeline recorre à análise heurística local. Para executar apenas o fallback, sem chamadas externas, use `ANALYZE_FORCE_LOCAL=1`.

No fallback, uma divergência não é inferida a partir de uma palavra isolada. A comparação agrupa acórdãos por área e tema e procura decisões opostas, como `Concedido` e `Negado`. A fundamentação identifica processos, anos e tribunais existentes no corpus. Esta comparação é um sinal para revisão, não uma conclusão automática de contradição jurídica.

## Caso de estudo: correio eletrónico processual

O corpus inclui duas decisões do **Tribunal da Relação de Coimbra** sobre a apresentação de atos processuais por correio eletrónico:

| Ano | Processo | Entendimento resumido |
| --- | --- | --- |
| 2016 | `170/13.8PTCBR.C1` | Considera inválida a apresentação de atos processuais por correio eletrónico, perante a revogação do regime que sustentava esse meio. |
| 2020 | `359/17.0GBFND.C1` | Admite a remessa de peças processuais por correio eletrónico no enquadramento jurídico analisado, citando jurisprudência do STJ. |

A diferença entre os resultados serve como exemplo de comparação temporal e temática. O acórdão de 2016 refere o Acórdão de Uniformização de Jurisprudência do STJ n.º 3/2014; isso não significa que os dois registos sejam decisões do STJ nem confirma, por si só, uma divergência material. É necessário ler os acórdãos e validar se as questões jurídicas e os enquadramentos são efetivamente comparáveis.

## Instalação

Requisitos: Node.js 20.9 ou superior e npm.

```bash
git clone https://github.com/Kurtesi27/bythelaw-jurisprudencia.git
cd bythelaw-jurisprudencia
npm install
```

### Configuração Gemini

Crie `.env.local` na raiz do projeto:

```dotenv
GEMINI_API_KEY=coloque_a_sua_chave_aqui
GEMINI_MODEL=gemini-2.5-flash
```

O ficheiro `.env.local` é ignorado pelo Git. Nunca publique a chave. Se for exposta, revogue-a no Google AI Studio e substitua-a por uma nova.

Sem chave, ou perante indisponibilidade ou quota esgotada, a análise continua pelo fallback local.

## Execução

### Dashboard

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). A página lê `data/processed_data.json` e disponibiliza pesquisa, filtros por tribunal e ano, ordenação cronológica e destaque de divergências.

### Pipeline de dados

1. Edite `data/source_urls.json` e adicione URLs diretos de acórdãos do DGSI.
2. Execute a recolha:

```bash
npm run scrape
```

3. Execute a análise com Gemini, quando configurado:

```bash
npm run analyze
```

Para executar apenas o fallback local no PowerShell:

```powershell
$env:ANALYZE_FORCE_LOCAL = "1"
npm run analyze
Remove-Item Env:ANALYZE_FORCE_LOCAL
```

No macOS/Linux:

```bash
ANALYZE_FORCE_LOCAL=1 npm run analyze
```

O intervalo entre pedidos ao DGSI pode ser alterado com `SCRAPE_DELAY_MS`, por exemplo:

```powershell
$env:SCRAPE_DELAY_MS = "2000"
npm run scrape
```

## Estrutura relevante

```text
app/
	page.tsx                 Dashboard interativo
	layout.tsx               Layout e metadados
data/
	source_urls.json         URLs de origem do DGSI
	raw_acordaos.json        Dados recolhidos
	processed_data.json      Dados analisados para a interface
	types.ts                 Interfaces TypeScript
scripts/
	scrape.ts                Recolha sequencial do DGSI
	analyze.ts               Análise LLM, comparação e fallback
```

## Qualidade de código

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Créditos

**Sandro Sousa** — autor do protótipo.
