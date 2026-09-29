'use client';

import { useState } from 'react';
import processedData from '../data/processed_data.json';
import type { ProcessedAcordao } from '../data/types';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sanitizeProcessedData(value: unknown): ProcessedAcordao[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate, index): ProcessedAcordao[] => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return [];

    const record = candidate as Record<string, unknown>;
    const data = textValue(record.data);
    const parsedYear = data.match(/\b(?:19|20)\d{2}\b/)?.[0];
    const ano = typeof record.ano === 'number' && Number.isFinite(record.ano)
      ? record.ano
      : parsedYear ? Number(parsedYear) : 0;
    const rawDivergence = typeof record.divergencia === 'object' && record.divergencia !== null
      ? record.divergencia as Record<string, unknown>
      : {};
    const tribunais = Array.isArray(rawDivergence.tribunaisEmConflito)
      ? rawDivergence.tribunaisEmConflito.filter((tribunal): tribunal is string => typeof tribunal === 'string')
      : [];
    const decision = record.decisao;

    return [{
      id: textValue(record.id) || `acordao-${index}`,
      processo: textValue(record.processo),
      data,
      ano,
      tribunal: textValue(record.tribunal),
      relator: textValue(record.relator),
      url: textValue(record.url),
      areaDireito: textValue(record.areaDireito),
      temaPrincipal: textValue(record.temaPrincipal),
      sumarioExecutivo: textValue(record.sumarioExecutivo),
      teseJuridica: textValue(record.teseJuridica),
      decisao: decision === 'Concedido' || decision === 'Negado' || decision === 'Anulado' || decision === 'Outro'
        ? decision
        : 'Outro',
      divergencia: {
        existeDivergencia: rawDivergence.existeDivergencia === true,
        temaConflito: textValue(rawDivergence.temaConflito),
        posicaoAdotada: textValue(rawDivergence.posicaoAdotada),
        tribunaisEmConflito: tribunais,
        fundamentacaoDivergencia: textValue(rawDivergence.fundamentacaoDivergencia)
      }
    }];
  });
}

const importedData: unknown = processedData;
const acordaos = sanitizeProcessedData(importedData);

function courtAbbreviation(tribunal: string): string {
  if (tribunal.includes('Supremo Tribunal de Justiça')) return 'STJ';
  if (tribunal.includes('Relação')) return tribunal.replace('Tribunal da Relação de ', 'TR ');
  if (tribunal.includes('Constitucional')) return 'TC';
  return tribunal;
}

function formatDate(value: string): string {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return value || 'Data não disponível';

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = match[3];
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function dateOrderValue(value: string, fallbackYear: number): number {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return fallbackYear * 10_000;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  return Number(`${match[3]}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`);
}

function decisionStyle(decision: ProcessedAcordao['decisao']): string {
  switch (decision) {
    case 'Concedido':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'Negado':
      return 'border-rose-200 bg-rose-50 text-rose-800';
    case 'Anulado':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    default:
      return 'border-stone-200 bg-stone-100 text-stone-700';
  }
}

function Kpi({
  label,
  value,
  caption,
  tone
}: {
  label: string;
  value: string | number;
  caption: string;
  tone: 'green' | 'rust' | 'ink' | 'gold';
}) {
  const toneStyle = {
    green: 'before:bg-emerald-700',
    rust: 'before:bg-[#b75236]',
    ink: 'before:bg-[#293b36]',
    gold: 'before:bg-[#c08c3e]'
  }[tone];

  return (
    <section className={`relative min-h-32 border border-[#e1e6e1] bg-white px-5 py-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${toneStyle}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#697570]">{label}</p>
      <p className="mt-3 font-serif text-3xl leading-none text-[#25342f]">{value}</p>
      <p className="mt-2 text-xs text-[#7c8782]">{caption}</p>
    </section>
  );
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [selectedCourt, setSelectedCourt] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [onlyDivergences, setOnlyDivergences] = useState(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(() => new Set());

  const tribunais = [...new Set(acordaos.map((acordao) => acordao?.tribunal ?? '').filter(Boolean))].sort();
  const anos = [...new Set(acordaos.map((acordao) => acordao?.ano ?? 0).filter((ano) => ano > 0))].sort((a, b) => b - a);
  const anosLabel = anos.length === 0
    ? 'Sem datas'
    : anos.length === 1
      ? String(anos[0])
      : `${Math.min(...anos)}–${Math.max(...anos)}`;
  const divergencias = acordaos.filter((acordao) => acordao?.divergencia?.existeDivergencia ?? false).length;
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-PT');
  const resultados = acordaos.filter((acordao) => {
    const matchesQuery = !normalizedQuery || [acordao?.processo ?? '', acordao?.temaPrincipal ?? '', acordao?.relator ?? '']
      .some((value) => (value ?? '').toLocaleLowerCase('pt-PT').includes(normalizedQuery));
    const matchesCourt = selectedCourt === 'all' || (acordao?.tribunal ?? '') === selectedCourt;
    const matchesYear = selectedYear === 'all' || String(acordao?.ano ?? '') === selectedYear;
    const matchesDivergence = !onlyDivergences || (acordao?.divergencia?.existeDivergencia ?? false);
    return matchesQuery && matchesCourt && matchesYear && matchesDivergence;
  }).sort((first, second) => {
    const difference = dateOrderValue(first?.data ?? '', first?.ano ?? 0) - dateOrderValue(second?.data ?? '', second?.ano ?? 0);
    return sortOrder === 'newest' ? -difference : difference;
  });
  const hasActiveFilters = Boolean(query || selectedCourt !== 'all' || selectedYear !== 'all' || onlyDivergences);

  function clearFilters() {
    setQuery('');
    setSelectedCourt('all');
    setSelectedYear('all');
    setOnlyDivergences(false);
  }

  function toggleSummary(id: string) {
    setExpandedSummaryIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(id)) nextIds.delete(id);
      else nextIds.add(id);
      return nextIds;
    });
  }

  return (
    <main className="min-h-screen bg-[#f3f5f2] text-[#25342f]">
      <header className="border-b border-[#e1e6e1] bg-white">
        <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
          <a href="#inicio" className="flex items-center gap-3" aria-label="ByTheLaw, início">
            <span className="flex size-9 items-center justify-center bg-[#263a34] font-serif text-lg text-white">B</span>
            <span className="text-[15px] font-semibold tracking-tight text-[#293b36]">ByTheLaw <span className="font-normal text-[#8b938e]">/ Jurisprudência</span></span>
          </a>
          <div className="flex items-center gap-2 text-xs text-[#68736e]">
            <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
            <span>Corpus local</span>
            <span className="hidden sm:inline">· {acordaos.length} acórdãos</span>
          </div>
        </div>
      </header>

      <div id="inicio" className="mx-auto max-w-[1440px] px-5 pb-16 pt-9 sm:px-8 lg:px-12 lg:pt-12">
        <section className="mb-8 flex flex-col justify-between gap-6 border-b border-[#dce2dc] pb-8 lg:flex-row lg:items-end">
          <div className="max-w-4xl">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a35138]">Observatório jurisprudencial</p>
            <h1 className="font-serif text-[30px] leading-[1.14] text-[#263a34] sm:text-[36px]">
              ByTheLaw Jurisprudência <span className="text-[#9ca6a0]">/</span>{' '}
              Monitor de Divergências Jurisprudenciais
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66716c]">
              Explore decisões, acompanhe entendimentos judiciais e identifique temas que merecem comparação entre tribunais e ao longo do tempo.
            </p>
          </div>
          <p className="shrink-0 border-l-2 border-[#c08c3e] pl-3 text-xs leading-5 text-[#68736e]">
            Atualização local<br /><span className="font-medium text-[#394941]">{acordaos.length} acórdãos carregados</span>
          </p>
        </section>

        <section aria-label="Indicadores do corpus" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Acórdãos analisados" value={acordaos.length} caption="Decisões no corpus carregado" tone="green" />
          <Kpi label="Tribunais cobertos" value={tribunais.length} caption={tribunais.map(courtAbbreviation).join(' · ') || 'Sem tribunais'} tone="ink" />
          <Kpi label="Conflitos detetados" value={divergencias} caption="Referências explícitas a divergência" tone="rust" />
          <Kpi label="Anos abrangidos" value={anosLabel} caption={anos.length === 1 ? 'Ano das decisões' : 'Intervalo das decisões'} tone="gold" />
        </section>

        <section aria-label="Pesquisa e filtros" className="mb-5 border border-[#dfe5df] bg-white p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(230px,1.5fr)_minmax(170px,1fr)_minmax(120px,.65fr)_minmax(150px,.9fr)_auto] lg:items-end">
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#697570]">Pesquisa</span>
              <span className="flex h-11 items-center gap-3 border border-[#dce2dc] bg-[#fbfcfa] px-3 focus-within:border-[#547568] focus-within:ring-2 focus-within:ring-[#547568]/15">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-[#77827c]" strokeWidth="1.7">
                  <circle cx="8.7" cy="8.7" r="5.7" />
                  <path d="m13 13 4 4" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Processo, tema ou relator"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm text-[#293b36] outline-none placeholder:text-[#9aa39d]"
                  type="search"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#697570]">Tribunal</span>
              <select value={selectedCourt} onChange={(event) => setSelectedCourt(event.target.value)} className="h-11 w-full border border-[#dce2dc] bg-[#fbfcfa] px-3 text-sm text-[#36453f] outline-none focus:border-[#547568] focus:ring-2 focus:ring-[#547568]/15">
                <option value="all">Todos os tribunais</option>
                {tribunais.map((tribunal) => <option key={tribunal} value={tribunal}>{tribunal}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#697570]">Ano</span>
              <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="h-11 w-full border border-[#dce2dc] bg-[#fbfcfa] px-3 text-sm text-[#36453f] outline-none focus:border-[#547568] focus:ring-2 focus:ring-[#547568]/15">
                <option value="all">Todos os anos</option>
                {anos.map((ano) => <option key={ano} value={ano}>{ano}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#697570]">Ordem cronológica</span>
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')} className="h-11 w-full border border-[#dce2dc] bg-[#fbfcfa] px-3 text-sm text-[#36453f] outline-none focus:border-[#547568] focus:ring-2 focus:ring-[#547568]/15">
                <option value="newest">Mais recente primeiro</option>
                <option value="oldest">Mais antigo primeiro</option>
              </select>
            </label>

            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-[#394941] lg:pb-1">
              <input
                type="checkbox"
                checked={onlyDivergences}
                onChange={(event) => setOnlyDivergences(event.target.checked)}
                className="size-4 accent-[#a35138]"
              />
              Mostrar apenas casos com divergência
            </label>
          </div>
        </section>

        <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#606c66]" aria-live="polite">
            <span className="font-semibold text-[#293b36]">{resultados.length}</span> {resultados.length === 1 ? 'acórdão' : 'acórdãos'} encontrados
          </p>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#9a4e38] underline decoration-[#c98c76] underline-offset-4 hover:text-[#733822]">
              Limpar filtros
            </button>
          )}
        </div>

        <section aria-label="Resultados da pesquisa" className="space-y-3">
          {resultados.map((acordao) => {
            const summaryId = `sumario-${acordao.id}`;
            const summaryExpanded = expandedSummaryIds.has(acordao.id);
            const summaryText = acordao.sumarioExecutivo || 'Sumário executivo não disponível.';

            return (
            <article key={acordao?.id ?? acordao?.processo ?? 'acordao-sem-id'} className={`border bg-white px-5 py-5 sm:px-6 ${(acordao?.divergencia?.existeDivergencia ?? false) ? 'border-l-[3px] border-l-[#b75236] border-y-[#e8d9d3] border-r-[#e8d9d3]' : 'border-[#e1e6e1]'}`}>
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#87918b]">Processo</p>
                  <a href={acordao?.url ?? '#'} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 break-all font-mono text-[14px] font-semibold text-[#315e50] underline decoration-[#b5c9bf] underline-offset-4 hover:text-[#1e4035]">
                    {acordao?.processo || 'Processo não identificado'}
                    <span aria-label="Abre no DGSI" className="shrink-0 font-sans text-xs">↗</span>
                  </a>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#697570]">
                    <span>{acordao?.tribunal ?? ''}</span><span aria-hidden="true" className="text-[#c2c9c3]">/</span>
                    <span>{formatDate(acordao?.data ?? '')}</span><span aria-hidden="true" className="text-[#c2c9c3]">/</span>
                    <span>Relator: {acordao?.relator || 'Não identificado'}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className={`inline-flex items-center border px-2.5 py-1 text-[11px] font-semibold ${decisionStyle(acordao.decisao)}`}>
                    {acordao?.decisao ?? 'Outro'}
                  </span>
                  <span className="inline-flex items-center border border-[#dfe5df] bg-[#f6f8f5] px-2.5 py-1 text-[11px] font-medium text-[#52615a]">
                    {acordao?.areaDireito ?? ''}
                  </span>
                </div>
              </div>

              <div className="mt-5 border-t border-[#edf0ed] pt-4">
                <h2 className="text-[17px] font-semibold leading-6 text-[#293b36]">{acordao?.temaPrincipal ?? ''}</h2>
                <p id={summaryId} className={`mt-2 max-w-5xl text-sm leading-6 text-[#5f6c65] ${summaryExpanded ? '' : 'line-clamp-3'}`}>
                  {summaryText}
                </p>
                {summaryText.length > 180 && (
                  <button
                    type="button"
                    aria-expanded={summaryExpanded}
                    aria-controls={summaryId}
                    onClick={() => toggleSummary(acordao.id)}
                    className="mt-2 text-xs font-semibold text-[#315e50] underline decoration-[#b5c9bf] underline-offset-4 hover:text-[#1e4035]"
                  >
                    {summaryExpanded ? 'Ver menos' : 'Ver sumário completo'}
                  </button>
                )}
              </div>

              {(acordao?.divergencia?.existeDivergencia ?? false) && (
                <div className="mt-4 border border-[#edd8ce] bg-[#fff8f4] px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-[#a3472e]">
                    <span className="flex size-5 items-center justify-center border border-[#d8a28f] text-[11px]" aria-hidden="true">!</span>
                    Divergência jurisprudencial
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="border border-[#d8b09f] bg-white px-2 py-1 text-[11px] font-bold text-[#98452e]">Ano {acordao?.ano ?? 'não identificado'}</span>
                    <span className="text-xs leading-5 text-[#705c54]">
                      Tribunais: {acordao?.divergencia?.tribunaisEmConflito?.filter(Boolean).length
                        ? acordao.divergencia.tribunaisEmConflito.filter(Boolean).join(' · ')
                        : acordao?.tribunal ?? 'Não identificado'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-[#573b32]">{acordao?.divergencia?.temaConflito ?? ''}</p>
                  <p className="mt-1 text-sm font-medium text-[#705044]">{acordao?.divergencia?.posicaoAdotada ?? ''}</p>
                  <p className="mt-1 text-sm leading-5 text-[#705c54]">{acordao?.divergencia?.fundamentacaoDivergencia ?? ''}</p>
                </div>
              )}

              <details className="group mt-4 border-t border-[#edf0ed] pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xs font-semibold text-[#476455] marker:hidden hover:text-[#263a34]">
                  <span>Consultar tese jurídica</span>
                  <span aria-hidden="true" className="text-base font-normal text-[#8b9890] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-5xl pt-3 text-sm leading-6 text-[#58655e]">{acordao?.teseJuridica ?? ''}</p>
              </details>
            </article>
            );
          })}

          {resultados.length === 0 && (
            <div className="border border-dashed border-[#cbd4cc] bg-white px-6 py-14 text-center">
              <p className="font-serif text-xl text-[#34483e]">Nenhum acórdão corresponde aos filtros</p>
              <p className="mt-2 text-sm text-[#738078]">Altere a pesquisa, o tribunal ou o ano para ver outros resultados.</p>
              <button type="button" onClick={clearFilters} className="mt-5 border border-[#8ca094] px-4 py-2 text-xs font-semibold text-[#315e50] hover:bg-[#f1f5f1]">
                Limpar filtros
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
