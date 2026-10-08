import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Settings2, Minus, Square, X, ArrowRight, ArrowUpRight, Check, LoaderCircle, Sparkles,
  Pause, Download, FolderOpen, Upload, ChevronDown, RotateCcw, Search, ImagePlus, Sun, Moon, Eye, PlugZap, Undo2 } from 'lucide-react';
import { DEFAULT_CONFIG, EMPTY, type Snapshot, type PublicConfig, type Result } from '../shared';
import { Book } from './Book';
import Settings from './Settings';
import Preview from './Preview';
import { Modal } from './Modal';

export default function App() {
  const [state, setState] = useState<Snapshot>(EMPTY);
  const [config, setConfig] = useState<PublicConfig>({ ...DEFAULT_CONFIG, hasKey: false, maxWords: 40, theme: 'light' });
  const [panel, setPanel] = useState<'settings' | 'preview' | 'cover' | 'help' | null>(null);
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false), [words, setWords] = useState(40);
  const [wordText, setWordText] = useState('40');
  const [dark, setDark] = useState(false);
  const dragDepth = useRef(0), noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = state.phase === 'translating', locked = Boolean(busy) || running;
  const connected = config.hasKey || config.provider === 'local';
  const complete = state.phase === 'complete' && Boolean(state.outputPath);
  const percent = state.total ? Math.floor(state.done / state.total * 100) : 0;
  const notify = useCallback((message: string) => { setNotice(message); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 7000); }, []);
  useEffect(() => {
    if (!window.folio) { setNotice('请使用桌面应用打开此界面。'); setReady(true); return; }
    const off = window.folio.onState(snapshot => setState(snapshot));
    void window.folio.init().then(result => {
      if (result.ok && result.data) { setState(result.data.state); setConfig(result.data.config); setWords(result.data.config.maxWords); }
      else setNotice(result.error || '初始化失败'); setReady(true);
    });
    return () => { off(); clearTimeout(noticeTimer.current); };
  }, []);
  useEffect(() => { setWords(state.maxWords); }, [state.maxWords]);
  useEffect(() => { setWordText(String(words)); }, [words]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => { const value = config.theme === 'system' ? (media.matches ? 'dark' : 'light') : config.theme; document.documentElement.dataset.theme = value; setDark(value === 'dark'); };
    update(); if (config.theme === 'system') media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [config.theme]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); if (!locked) setPanel(p => p === 'settings' ? null : 'settings'); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [locked]);

  async function action<T>(label: string, fn: () => Promise<Result<T>>, success?: (data: T) => void) {
    setBusy(label);
    try { const result = await fn(); if (!result.ok) notify(result.error || '操作失败'); else if (result.data !== undefined) success?.(result.data); }
    catch { notify('操作失败，请重试。'); }
    finally { setBusy(''); }
  }
  const importBook = () => void action('import', () => window.folio.importBook(), value => { if (value) setState(value); });
  const coverAction = (kind: 'choose' | 'reset' | 'search' | 'undo') => void action('cover', () => window.folio.cover(kind), value => { if (value) { setState(value); setPanel(null); } });
  async function split(value = words) {
    if (value === state.maxWords || locked || !state.book) return;
    setBusy('split');
    try {
      const result = await window.folio.split(value);
      if (result.ok && result.data) setState(result.data);
      else { notify(result.error || '无法更新对照长度。'); setWords(state.maxWords); setWordText(String(state.maxWords)); }
    } catch { notify('无法更新对照长度。'); setWords(state.maxWords); setWordText(String(state.maxWords)); }
    finally { setBusy(''); }
  }
  function translate(sample: boolean) {
    if (!state.book) { importBook(); return; }
    if (!connected) { setPanel('settings'); return; }
    void action('translate', () => window.folio.translate(sample));
  }
  function theme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    void action('theme', () => window.folio.settings({ ...config, theme: next }), value => setConfig(value));
  }

  return <div className="app-shell" onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
    <div className="titlebar"><div className="wordmark"><span className="brand-mark"><BookOpen size={16}/></span><strong>对页</strong><span className="wordmark-divider"/><span>双语制书</span></div>
      <div className="window-buttons"><button aria-label="最小化" onClick={() => window.folio.window('minimize')}><Minus size={15}/></button><button aria-label="最大化或还原" onClick={() => window.folio.window('maximize')}><Square size={11}/></button><button className="close-window" aria-label="关闭应用" onClick={() => window.folio.window('close')}><X size={16}/></button></div></div>
    <main>
      <nav className="toolbar glass"><div className="workspace-tabs"><button className="active" onClick={() => setPanel(null)}><BookOpen size={16}/> 制书台</button><button onClick={() => setPanel('preview')}><Eye size={16}/> 对照预览</button></div>
        <div className="toolbar-right"><button className={`connection-pill ${connected ? 'connected' : ''}`} disabled={locked} onClick={() => setPanel('settings')}><span className="status-dot"/>{connected ? config.model : '连接翻译模型'}<ChevronDown size={12}/></button><span className="toolbar-divider"/><button className="icon-button" disabled={locked} aria-label="切换深浅主题" title="切换深浅主题" onClick={theme}>{dark ? <Sun size={17}/> : <Moon size={17}/>}</button><button className="icon-button" disabled={locked} aria-label="模型设置" title="模型设置 · Ctrl+," onClick={() => setPanel('settings')}><Settings2 size={18}/></button></div>
      </nav>
      <header className="intro"><div><p className="eyebrow">为原文阅读，留一页余地</p><h1>让每一句，都读得懂<span>。</span></h1></div><button className="quiet-link" onClick={() => setPanel('help')}>在微信读书里阅读 <ArrowUpRight size={15}/></button></header>
      <section className={`book-stage ${dragging ? 'dragging' : ''}`} aria-label="原书与双语书"
        onDragEnter={e => { e.preventDefault(); if (!locked && e.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } }}
        onDragLeave={e => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
        onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (locked) { notify('请先暂停翻译，再导入其他书籍。'); return; }
          if (e.dataTransfer.files.length !== 1) { notify('请每次拖入一本 EPUB。'); return; }
          const file = e.dataTransfer.files[0]; if (!file.name.toLowerCase().endsWith('.epub')) { notify('这里接收 EPUB 文件；封面图片请点击右侧书籍更换。'); return; }
          void action('import', () => window.folio.drop(file), value => { if (value) setState(value); }); }}>
        <div className="stage-light"/><div className="shelf-back"/><div className="shelf-top"/><div className="shelf-edge"/>
        <div className="book-column source-column"><div className="book-label"><span>01</span> 原书 <small>{state.book ? '已导入' : 'EPUB'}</small></div>
          <div className="book-space"><Book book={state.book} busy={locked} onClick={importBook}/></div>
          <div className="book-meta"><strong title={state.book?.filename}>{state.book?.title || '从想读的那本开始'}</strong><span>{state.book ? `${state.book.chapterCount} 个章节 · ${state.book.wordCount.toLocaleString()} 个原文词` : '拖入 EPUB，或点击书籍选择文件'}</span></div></div>
        <div className="bridge"><div className={`bridge-icon ${running ? 'working' : ''}`}>{running ? <LoaderCircle size={21} className="spin"/> : complete ? <Check size={23}/> : <ArrowRight size={24}/>}</div><span>{running ? `${percent}%` : complete ? '对照已完成' : '短句逐组对照'}</span><small>原文与中文，紧挨着读</small></div>
        <div className="book-column result-column"><div className="book-label"><span>02</span> 双语书 <small className={complete ? 'ready-badge' : ''}>{complete ? '可导出' : '英中对照'}</small></div>
          <div className="book-space"><Book book={state.book} result complete={complete} busy={locked} onClick={() => setPanel('cover')} onDrag={() => window.folio.drag()}/></div>
          <div className="book-meta"><strong>{complete ? '带着原文，一起读下去' : state.done ? '译文正在一页页长出来' : '熟悉的语言，陪你读原文'}</strong><span>{complete ? '点击更换封面 · 拖出保存 EPUB' : state.book ? '点击书籍查找或替换封面' : '保留原书章节、图片与目录'}</span></div></div>
        {dragging && <div className="drop-overlay"><Upload size={33}/><h2>把原书放在这里</h2><p>松开即可导入 EPUB</p></div>}
        {busy === 'import' && <div className="drop-overlay loading-overlay"><LoaderCircle size={31} className="spin"/><h2>正在翻开这本书</h2><p>读取章节、封面与原文</p></div>}
      </section>

      <section className="control-dock glass">
        <div className="dock-settings"><div className="language-setting"><span className="field-label">阅读语言</span><div><strong>{state.book?.language?.toLowerCase().startsWith('en') || !state.book ? '英文原书' : `原文 · ${state.book.language}`}</strong><ArrowRight size={15}/><strong>简体中文</strong></div><small>原文在上，中文紧随其后</small></div>
          <div className="alignment-setting"><div className="field-label">每组原文长度 <span><input aria-label="每组原文词数" type="number" min={15} max={100} step={5} disabled={locked || !state.book} value={wordText} onChange={e => setWordText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={() => { const value = Math.round(Math.max(15, Math.min(100, Number(wordText) || 40))); setWords(value); setWordText(String(value)); void split(value); }}/> 词以内</span></div>
            <input className="range" type="range" aria-label="调整短句对照长度" min={15} max={100} step={5} value={words} disabled={locked || !state.book} onChange={e => setWords(Number(e.target.value))} onPointerUp={() => void split()} onKeyUp={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) void split(); }}/>
            <div className="range-captions"><small>更紧凑</small><small>完整句子优先 · 长句再拆分</small><small>更连贯</small></div></div>
          <div className="output-setting"><span className="field-label">输出格式</span><strong><BookOpen size={16}/> 双语 EPUB</strong><small>适合手机逐组对照阅读</small></div>
        </div>
        <div className="dock-bottom"><div className="progress-summary">
          {running ? <LoaderCircle size={17} className="spin"/> : complete ? <Check size={18}/> : <span className={`status-dot ${state.phase === 'error' ? 'error-dot' : ''}`}/>}
          <div><span className={state.phase === 'error' ? 'error-text' : ''}>{state.book ? complete ? '你的双语书，准备好了' : running ? `已完成 ${state.done} / ${state.total} 组对照` : state.done ? `已保存 ${state.done} / ${state.total} 组对照` : `共 ${state.total} 组短句，等你开始` : '导入一本书，开启双语阅读'}</span>
            <small>{state.book ? connected ? `使用 ${config.model} · 进度自动保存` : '先连接模型，即可开始试译' : '文件在本机处理 · 支持自定义模型'}</small></div></div>
          <div className="main-actions">{complete ? <><button className="button secondary" disabled={locked} onClick={() => void action('reveal', () => window.folio.reveal())}><FolderOpen size={16}/> 打开文件夹</button><button className="button primary" disabled={locked} onClick={() => void action('export', () => window.folio.exportBook(), file => { if (file) notify('双语 EPUB 已保存到你选择的位置。'); })}><Download size={17}/> 另存为 EPUB</button></> : running ? <><button className="button secondary" onClick={() => setPanel('preview')}><Eye size={16}/> 查看译文</button><button className="button primary" disabled={Boolean(busy)} onClick={() => void action('pause', () => window.folio.pause())}>{busy === 'pause' ? <LoaderCircle className="spin" size={16}/> : <Pause size={16}/>} 暂停翻译</button></> : <><button className="button secondary" disabled={!state.book || locked} onClick={() => translate(true)}>先试译 8 组</button><button className="button primary" disabled={locked || !ready} onClick={() => translate(false)}>{busy ? <LoaderCircle className="spin" size={17}/> : state.book ? <Sparkles size={17}/> : <PlusIcon/>}{state.book ? state.done ? '继续翻译全书' : '开始翻译' : '导入原书'}</button></>}</div>
        </div>
        {state.total > 0 && <div className="progress-line"><span style={{width: `${percent}%`}}/></div>}
      </section>
      <div className="bottom-note"><span>{state.message || '一本原书，一份对照。慢慢读，也能读得更远。'}</span><button onClick={() => setPanel('preview')}>看看排版效果 <ArrowRight size={13}/></button></div>
    </main>
    <footer className="app-footer"><span><span className="status-dot"/> 对页 0.1.0</span><span>{state.usage.input + state.usage.output > 0 ? `累计 ${Number(state.usage.input + state.usage.output).toLocaleString()} tokens · 以服务商账单为准` : '为专注阅读而做'}</span><span>EPUB → 双语 EPUB</span></footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {panel === 'settings' && <Settings config={config} onClose={() => setPanel(null)} onSaved={value => { setConfig(value); notify('模型配置已保存。'); }}/>} 
    {panel === 'preview' && <Preview state={state} onClose={() => setPanel(null)}/>}
    {panel === 'cover' && <Modal title="给双语书换个封面" subtitle="选择一张你喜欢的图，让它成为书架上的新朋友。" onClose={() => { if (!busy) setPanel(null); }}>
      <div className="cover-actions"><button disabled={locked} onClick={() => coverAction('choose')}><ImagePlus size={22}/><span><strong>从电脑选择图片</strong><small>JPG、PNG、WebP · 最长边自动缩放至 2000 像素</small></span><ArrowRight size={17}/></button><button disabled={locked} onClick={() => coverAction('search')}><Search size={22}/><span><strong>按书名查找封面</strong><small>在浏览器中搜索；保存图片后从电脑选择</small></span><ArrowUpRight size={17}/></button><button disabled={locked} onClick={() => coverAction('reset')}><RotateCcw size={21}/><span><strong>使用原书封面</strong><small>恢复这本书原来的样子</small></span></button><button disabled={locked} onClick={() => coverAction('undo')}><Undo2 size={21}/><span><strong>撤销上次封面修改</strong><small>恢复本次会话的上一个封面</small></span></button>{busy && <p className="saving-cover"><LoaderCircle className="spin" size={17}/> 正在更新封面与 EPUB…</p>}</div>
    </Modal>}
    {panel === 'help' && <Modal title="在微信读书里，读你的双语书" subtitle="三个步骤，把短句对照带到手机上。" onClose={() => setPanel(null)}>
      <ol className="help-steps"><li><span>01</span><div><strong>在对页中完成翻译</strong><p>先试译 8 组，确认语气与对照长度，再翻译全书。</p></div></li><li><span>02</span><div><strong>保存双语 EPUB</strong><p>将右侧书籍拖到文件夹，或点击“另存为 EPUB”。</p></div></li><li><span>03</span><div><strong>导入微信读书</strong><p>在微信读书官方网页的“传书”入口选择文件，或在手机上用微信读书打开 EPUB。入口以你的客户端版本为准。</p></div></li></ol>
      <p className="help-note">短句对照直接写在书内，无需阅读器支持特殊插件。这里的预览不能代替微信读书实测；字体、间距与分页可能因客户端而变化。</p>
      <footer className="modal-footer"><span>仅处理文字型、无内容加密的 EPUB</span><button className="button primary" onClick={() => void window.folio.external('weread')}>打开微信读书 <ArrowUpRight size={16}/></button></footer>
    </Modal>}
  </div>;
}
function PlusIcon() { return <Upload size={17}/>; }
