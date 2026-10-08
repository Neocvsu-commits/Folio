export type Phase = 'empty' | 'ready' | 'translating' | 'paused' | 'complete' | 'error';
export interface ModelConfig {
  provider: 'deepseek' | 'compatible' | 'local';
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  concurrency: number;
}
export interface PublicConfig extends Omit<ModelConfig, 'apiKey'> { hasKey: boolean; maxWords: number; theme: 'light' | 'dark' | 'system' }
export interface Pair { id: string; source: string; translation?: string; chapter: number; heading: boolean }
export interface BookInfo {
  title: string; author: string; filename: string; path: string; language: string;
  wordCount: number; chapterCount: number; cover?: string; resultCover?: string;
  chapters: { title: string; count: number }[];
}
export interface Snapshot {
  phase: Phase; book: BookInfo | null; total: number; done: number; maxWords: number;
  currentChapter: string; message: string; outputPath: string | null; sample: boolean;
  usage: { input: number; output: number }; preview: Pair[];
}
export interface Result<T> { ok: boolean; data?: T; error?: string }
export const DEFAULT_CONFIG: ModelConfig = {
  provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
  apiKey: '', prompt: '', concurrency: 2,
};
export const EMPTY: Snapshot = { phase: 'empty', book: null, total: 0, done: 0, maxWords: 40,
  currentChapter: '', message: '', outputPath: null, sample: false, usage: { input: 0, output: 0 }, preview: [] };
export interface DesktopApi {
  init(): Promise<Result<{ config: PublicConfig; state: Snapshot; version: string }>>;
  importBook(path?: string): Promise<Result<Snapshot | null>>;
  drop(file: File): Promise<Result<Snapshot | null>>;
  settings(config: Omit<PublicConfig, 'hasKey'> & { apiKey?: string; clearKey?: boolean }): Promise<Result<PublicConfig>>;
  test(config: ModelConfig): Promise<Result<string>>;
  split(maxWords: number): Promise<Result<Snapshot>>;
  translate(sample: boolean): Promise<Result<null>>;
  pause(): Promise<Result<null>>;
  preview(chapter: number): Promise<Result<Pair[]>>;
  cover(action: 'choose' | 'reset' | 'search' | 'undo'): Promise<Result<Snapshot | null>>;
  exportBook(): Promise<Result<string | null>>;
  reveal(): Promise<Result<null>>;
  external(target: 'weread' | 'docs'): Promise<Result<null>>;
  onState(callback: (state: Snapshot) => void): () => void;
  drag(): void;
  window(action: 'minimize' | 'maximize' | 'close'): void;
}
declare global { interface Window { folio: DesktopApi } }
