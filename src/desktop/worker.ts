import { parentPort, workerData } from 'node:worker_threads';
import { Engine } from '../core/engine';
import { completion } from '../core/provider';
import type { ModelConfig } from '../shared';
const port = parentPort!;
const engine = new Engine(workerData.dataDir, workerData.config, state => port.postMessage({ event: 'state', state }));
port.on('message', async ({ id, method, data }: { id: number; method: string; data: unknown }) => {
  try {
    let result: unknown = null;
    switch (method) {
      case 'open': { const value = data as { path: string; maxWords: number }; result = await engine.open(value.path, value.maxWords); break; }
      case 'split': result = await engine.split(data as number); break;
      case 'config': await engine.setConfig(data as ModelConfig); break;
      case 'state': result = engine.state; break;
      case 'preview': result = engine.preview(data as number); break;
      case 'start': engine.start(Boolean(data)); break;
      case 'pause': await engine.pause(); break;
      case 'cover': {
        const value = data as { bytes?: Uint8Array; undo?: boolean };
        result = await engine.setCover(value.bytes ? { data: Buffer.from(value.bytes), mime: 'image/jpeg' } : undefined, value.undo); break;
      }
      case 'test': {
        const response = await completion(data as ModelConfig, [{ role: 'user', content: '只回复：连接成功' }], new AbortController().signal, true);
        result = `连接成功，模型已返回响应。${response.input + response.output ? `本次消耗 ${response.input + response.output} tokens。` : ''}`; break;
      }
      default: throw new Error('未知操作。');
    }
    port.postMessage({ id, ok: true, data: result });
  } catch (error) { port.postMessage({ id, ok: false, error: error instanceof Error ? error.message : '操作失败。' }); }
});
