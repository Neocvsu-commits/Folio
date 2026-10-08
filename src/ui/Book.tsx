import { Plus, MoveUpRight, Image } from 'lucide-react';
import type { BookInfo } from '../shared';
export function Book({ book, result = false, complete, busy, onClick, onDrag }: {
  book: BookInfo | null; result?: boolean; complete?: boolean; busy?: boolean; onClick: () => void; onDrag?: () => void;
}) {
  const cover = result ? book?.resultCover || book?.cover : book?.cover;
  return <button className={`book-object ${result ? 'translated' : 'original'} ${book ? 'loaded' : 'empty'} ${complete ? 'finished' : ''}`}
    onClick={onClick} disabled={busy || (result && !book)} draggable={Boolean(result && complete)}
    onDragStart={e => { e.preventDefault(); onDrag?.(); }} aria-label={result ? '更换双语书封面；完成后可拖出 EPUB' : book ? '更换原书' : '导入 EPUB 原书'}>
    <span className="book-pages"/><span className="book-back"/>
    <span className="book-front">
      {cover ? <img className="cover-image" src={cover} alt={book?.title ?? '书籍封面'} draggable={false}/> : <>
        <span className="cover-topline">{result ? '字句之间 · 世界相通' : '从一本原书开始'}</span>
        <span className="cover-ornament"><span/><span/><span/></span>
        <span className="cover-title">{book?.title || (result ? '两种语言\n同一个世界' : '下一本\n想读的书')}</span>
        <span className="cover-rule"/>
        <span className="cover-author">{book?.author || (result ? '英 文 × 中 文' : '把好奇翻开')}</span>
        <span className="cover-imprint">{result ? '双语对照版' : '原 文 书'}</span>
      </>}
      <span className="spine-groove"/>
      {result && <span className="book-ribbon">双语</span>}
      <span className="book-hover">{result ? <><Image size={18}/> 更换封面</> : <><Plus size={19}/>{book ? '更换原书' : '选择 EPUB'}</>}</span>
    </span>
    {result && complete && <span className="drag-tab"><MoveUpRight size={13}/> 拖出保存</span>}
  </button>;
}
