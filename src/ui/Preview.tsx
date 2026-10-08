import { useEffect, useRef, useState } from 'react';
import { BookOpen, Smartphone, Columns2, LoaderCircle } from 'lucide-react';
import { Modal } from './Modal';
import type { Snapshot, Pair } from '../shared';

const demo = [
  { source: 'A book is a quiet conversation between two people who may never meet.', translation: '一本书，是两个或许永远不会见面的人之间，一场安静的交谈。' },
  { source: 'When we read in another language, that conversation asks us to slow down.', translation: '用另一种语言阅读时，这场交谈让我们放慢脚步。' },
  { source: 'A few lines of translation can help us find our way, without taking us away from the original voice.', translation: '几行译文便能帮我们找到方向，同时让我们留在原作的声音里。' },
];
export default function Preview({ state, onClose }: { state: Snapshot; onClose: () => void }) {
  const [chapter, setChapter] = useState(0), [pairs, setPairs] = useState<Pair[]>([]), [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'phone' | 'columns'>('phone'), [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    if (!state.book) return;
    const version = ++request.current; setLoading(true);
    void window.folio.preview(chapter).then(result => {
      if (version !== request.current) return;
      if (result.ok) { setPairs(result.data!); setError(''); } else setError(result.error!);
      setLoading(false);
    });
    return () => { request.current++; };
  }, [chapter, state.done, state.book?.path]);
  const visible = state.book ? pairs : demo.map((p, i) => ({ ...p, id: String(i), chapter: 0, heading: false }));
  return <Modal title="短句对照预览" subtitle={state.book ? state.book.title : '排版示例 · 以下为原创示例文字，不会调用 API'} onClose={onClose} wide>
    <div className="preview-tools"><label className="chapter-select"><BookOpen size={16}/><select value={chapter} onChange={e => setChapter(Number(e.target.value))} disabled={!state.book} aria-label="预览章节">
      {state.book ? state.book.chapters.map((c, i) => <option key={i} value={i}>{String(i + 1).padStart(2, '0')} · {c.title}</option>) : <option>一场安静的交谈</option>}
    </select></label><div className="segmented"><button className={mode === 'phone' ? 'active' : ''} onClick={() => setMode('phone')}><Smartphone size={15}/> 手机排版</button><button className={mode === 'columns' ? 'active' : ''} onClick={() => setMode('columns')}><Columns2 size={15}/> 并排校对</button></div></div>
    <div className={`preview-scene ${mode}`}>
      <article className="reading-page"><div className="reading-running-title">{state.book?.title || '阅读，从理解开始'}</div>
        {loading ? <div className="preview-loading"><LoaderCircle className="spin"/> 正在读取章节</div> : error ? <p className="inline-notice error">{error}</p> : visible.length ? visible.map((pair, i) => <section className={`reading-pair ${pair.heading ? 'heading' : ''}`} key={pair.id}>
          <span className="pair-number">{String(i + 1).padStart(2, '0')}</span><p lang="en" className="reading-source">{pair.source}</p><p lang="zh-CN" className={`reading-translation ${!pair.translation ? 'pending' : ''}`}>{pair.translation || '这一组还未翻译'}</p>
        </section>) : <p>这一章节没有需要翻译的文字。</p>}
      </article>
    </div>
    <footer className="preview-footer"><span className="status-dot"/> 导出内容为原文、中文交替排列。这里模拟手机宽度，实际字体与分页由微信读书决定。</footer>
  </Modal>;
}
