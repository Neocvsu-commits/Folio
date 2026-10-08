import { useState } from 'react';
import { Eye, EyeOff, PlugZap, ArrowUpRight, LoaderCircle, Check } from 'lucide-react';
import { Modal } from './Modal';
import { DEFAULT_CONFIG, type PublicConfig } from '../shared';
export default function Settings({ config, onClose, onSaved }: { config: PublicConfig; onClose: () => void; onSaved: (value: PublicConfig) => void }) {
  const [draft, setDraft] = useState({ ...config, apiKey: '', clearKey: false });
  const [showKey, setShowKey] = useState(false), [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [success, setSuccess] = useState(false);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  function preset(provider: PublicConfig['provider']) {
    const values = provider === 'deepseek' ? { baseUrl: DEFAULT_CONFIG.baseUrl, model: DEFAULT_CONFIG.model } :
      provider === 'local' ? { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' } : { baseUrl: 'https://your-provider.example/v1', model: '' };
    setDraft(current => ({ ...current, provider, ...values, apiKey: '', clearKey: true, hasKey: false })); setNotice('');
  }
  async function test() {
    setBusy('test'); setNotice('');
    try {
      const result = await window.folio.test(draft);
      setNotice(result.ok ? result.data! : result.error!); setSuccess(result.ok);
    } finally { setBusy(''); }
  }
  async function save() {
    setBusy('save'); setNotice('');
    try {
      const result = await window.folio.settings({ ...draft, clearKey: draft.clearKey && !draft.apiKey });
      if (result.ok && result.data) { onSaved(result.data); onClose(); } else { setNotice(result.error!); setSuccess(false); }
    } finally { setBusy(''); }
  }
  return <Modal title="连接你的翻译模型" subtitle="用自己的 API，给每本书选择合适的译者。" onClose={busy ? () => {} : onClose}>
    <div className="settings-body">
      <fieldset disabled={Boolean(busy)}>
        <label>服务提供方<select value={draft.provider} onChange={e => preset(e.target.value as PublicConfig['provider'])}><option value="deepseek">DeepSeek</option><option value="compatible">自定义 · OpenAI 兼容接口</option><option value="local">本地模型 · Ollama / LM Studio</option></select></label>
        <div className="settings-two"><label>API 服务地址<input type="url" value={draft.baseUrl} spellCheck={false} onChange={e => change('baseUrl', e.target.value)} placeholder="https://api.deepseek.com"/></label>
          <label>模型名称<input value={draft.model} spellCheck={false} onChange={e => change('model', e.target.value)} placeholder="填写服务商提供的模型 ID"/></label></div>
        <label>API 密钥 <span className="optional">{config.hasKey && draft.baseUrl === config.baseUrl && !draft.clearKey ? '已加密保存，留空沿用' : draft.provider === 'local' ? '本地服务可留空' : ''}</span>
          <span className="secret-input"><input type={showKey ? 'text' : 'password'} autoComplete="off" value={draft.apiKey} onChange={e => change('apiKey', e.target.value)} placeholder={config.hasKey && !draft.clearKey ? '••••••••••••••••' : '仅存储在你的电脑上'}/><button type="button" className="icon-button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span>
        </label>
        {config.hasKey && <label className="check-row"><input type="checkbox" checked={draft.clearKey} onChange={e => change('clearKey', e.target.checked)}/> 清除之前保存的密钥</label>}
        <details className="advanced"><summary>翻译偏好与高级设置</summary><label>翻译偏好 / 术语表<textarea rows={3} value={draft.prompt} onChange={e => change('prompt', e.target.value)} placeholder={'例如：保留作者的文学语气。\nrendering = 渲染；mesh = 网格。'}/></label>
          <div className="settings-two"><label>同时请求数<select value={draft.concurrency} onChange={e => change('concurrency', Number(e.target.value))}><option value={1}>1 · 稳定优先</option><option value={2}>2 · 均衡</option><option value={3}>3</option><option value={4}>4 · 更快</option></select></label>
            <label>界面主题<select value={draft.theme} onChange={e => change('theme', e.target.value as PublicConfig['theme'])}><option value="light">浅色 · 晨光</option><option value="dark">深色 · 夜读</option><option value="system">跟随系统</option></select></label></div></details>
      </fieldset>
      <p className="privacy-note">密钥由 Windows 加密保存。开始翻译后，待译文本会发送至你配置的模型服务；API 费用由该服务收取。</p>
      {notice && <div className={`inline-notice ${success ? 'success' : 'error'}`} role="status">{success && <Check size={16}/>} {notice}</div>}
    </div>
    <footer className="modal-footer"><button className="text-button" onClick={() => void window.folio.external('docs')}>接口文档 <ArrowUpRight size={14}/></button><div><button className="button secondary" disabled={Boolean(busy)} onClick={() => void test()}>{busy === 'test' ? <LoaderCircle className="spin" size={16}/> : <PlugZap size={16}/>} 测试连接</button><button className="button primary" disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' && <LoaderCircle className="spin" size={16}/>} 保存配置</button></div></footer>
  </Modal>;
}
