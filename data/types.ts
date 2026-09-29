export interface RawAcordao {
  id: string;
  url: string;
  tribunal: string;
  data: string;
  processo: string;
  relator: string;
  sumario: string;
  textoIntegral: string;
}

export interface DivergenciaInfo {
  existeDivergencia: boolean;
  temaConflito: string; // Ex: Validade de apreensão de emails sem autorização do juiz
  posicaoAdotada: string; // Ex: Inadmissível / Nula (necessita de juiz) vs Admissível
  tribunaisEmConflito?: string[]; // Ex: ["Tribunal Constitucional", "STJ"]
  fundamentacaoDivergencia: string;
}

export interface ProcessedAcordao {
  id: string;
  processo: string;
  data: string;
  ano: number;
  tribunal: string;
  relator: string;
  url: string;
  areaDireito: string; // Ex: Direito Penal e Processual Penal, Direito do Trabalho
  temaPrincipal: string; // Ex: Prova Digital e Interceção de Comunicações
  sumarioExecutivo: string; // Resumo em 2 ou 3 frases para leigos/gestores
  teseJuridica: string; // O princípio fundamental de direito fixado pelo acórdão
  decisao: 'Concedido' | 'Negado' | 'Anulado' | 'Outro';
  divergencia: DivergenciaInfo;
}