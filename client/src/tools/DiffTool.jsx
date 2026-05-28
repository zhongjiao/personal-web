import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DiffEditor } from '@monaco-editor/react';
import { parseFile, detectLanguageSmart } from '../utils/fileParser.js';

const LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'json', 'html', 'css',
  'markdown', 'python', 'java', 'go', 'sql', 'xml', 'yaml', 'shell'
];

const FILE_ACCEPT = [
  '.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yml', '.yaml',
  '.py', '.java', '.go', '.sql', '.sh', '.csv', '.log',
  '.doc', '.docx', '.pdf'
].join(',');

export default function DiffTool() {
  const [searchParams] = useSearchParams();
  const apiId = searchParams.get('id');

  const [original, setOriginal] = useState('// 选择左/右两个文件，自动识别语言并对比差异\n// 支持 文本/代码/DOCX/PDF\n');
  const [modified, setModified] = useState('// 修改后内容（右侧）\n');

  // 'auto' 表示自动模式；其它具体语言代表用户手动指定
  const [langMode, setLangMode] = useState('auto');

  const [originalName, setOriginalName] = useState('');
  const [modifiedName, setModifiedName] = useState('');
  // 是否是文档型（docx/pdf）→ 强制 plaintext
  const [originalIsDoc, setOriginalIsDoc] = useState(false);
  const [modifiedIsDoc, setModifiedIsDoc] = useState(false);

  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);

  const originalInputRef = useRef(null);
  const modifiedInputRef = useRef(null);

  // ---- 计算实际生效的语言 ----
  const effectiveLanguage = useMemo(() => {
    if (langMode !== 'auto') return langMode; // 用户手动选择
    // 文档型一律 plaintext
    if (originalIsDoc || modifiedIsDoc) return 'plaintext';
    // 综合两侧（任一可识别即用）
    const l1 = detectLanguageSmart(originalName, original);
    const l2 = detectLanguageSmart(modifiedName, modified);
    if (l1 !== 'plaintext') return l1;
    if (l2 !== 'plaintext') return l2;
    return 'plaintext';
  }, [langMode, originalIsDoc, modifiedIsDoc, originalName, modifiedName, original, modified]);

  // ---- 通过 URL ?id=xxx 从后端拉取数据 ----
  useEffect(() => {
    if (!apiId) return;
    fetch(`/api/diff/pull/${encodeURIComponent(apiId)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          setOriginal(json.data.original || '');
          setModified(json.data.modified || '');
          if (json.data.language) setLangMode(json.data.language);
          setOriginalName('[API] original');
          setModifiedName('[API] modified');
          setBanner({ type: 'success', message: `已从 API 加载数据 (id=${apiId})` });
        } else {
          setBanner({ type: 'error', message: json.message || '从 API 加载失败' });
        }
      })
      .catch(err => {
        setBanner({ type: 'error', message: '请求失败：' + err.message });
      });
  }, [apiId]);

  const handlePick = async (e, side) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setBanner({ type: 'info', message: `正在解析 ${file.name} ...` });
    try {
      const { text, kind, warning } = await parseFile(file);
      const isDoc = kind === 'docx' || kind === 'pdf' || kind === 'doc';
      if (side === 'original') {
        setOriginal(text);
        setOriginalName(file.name);
        setOriginalIsDoc(isDoc);
      } else {
        setModified(text);
        setModifiedName(file.name);
        setModifiedIsDoc(isDoc);
      }
      const tag = kind === 'docx' ? '[DOCX]' : kind === 'pdf' ? '[PDF]' : kind === 'doc' ? '[DOC]' : '';
      setBanner({
        type: warning ? 'warning' : 'success',
        message: warning
          ? `${file.name}：${warning}`
          : `已加载 ${tag} ${file.name}${kind === 'text' ? '' : '（已转纯文本）'}`
      });
    } catch (err) {
      setBanner({ type: 'error', message: `解析失败：${err.message || err}` });
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleSwap = () => {
    setOriginal(modified);
    setModified(original);
    setOriginalName(modifiedName);
    setModifiedName(originalName);
    setOriginalIsDoc(modifiedIsDoc);
    setModifiedIsDoc(originalIsDoc);
  };

  const handleClear = () => {
    setOriginal('');
    setModified('');
    setOriginalName('');
    setModifiedName('');
    setOriginalIsDoc(false);
    setModifiedIsDoc(false);
    setLangMode('auto');
    setBanner(null);
  };

  const handlePushToApi = async () => {
    try {
      const resp = await fetch('/api/diff/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, modified, language: effectiveLanguage })
      });
      const json = await resp.json();
      if (json.success) {
        const url = `${window.location.origin}/tools/diff?id=${json.id}`;
        await navigator.clipboard?.writeText(url).catch(() => {});
        setBanner({ type: 'success', message: `已推送，分享链接已复制：${url}` });
      } else {
        setBanner({ type: 'error', message: json.message || '推送失败' });
      }
    } catch (err) {
      setBanner({ type: 'error', message: '推送失败：' + err.message });
    }
  };

  return (
    <div className="diff-page">
      <div className="diff-toolbar">
        <div className="group">
          <span className="group-label">原始：</span>
          <button
            className="btn"
            disabled={loading}
            onClick={() => originalInputRef.current?.click()}
            title="支持 txt / md / 代码 / docx / pdf"
          >
            选择本地文件
          </button>
          <input
            ref={originalInputRef}
            type="file"
            accept={FILE_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => handlePick(e, 'original')}
          />
          {originalName && <span className="file-info">{originalName}</span>}
        </div>

        <div className="group">
          <span className="group-label">修改：</span>
          <button
            className="btn"
            disabled={loading}
            onClick={() => modifiedInputRef.current?.click()}
            title="支持 txt / md / 代码 / docx / pdf"
          >
            选择本地文件
          </button>
          <input
            ref={modifiedInputRef}
            type="file"
            accept={FILE_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => handlePick(e, 'modified')}
          />
          {modifiedName && <span className="file-info">{modifiedName}</span>}
        </div>

        <div className="group">
          <span className="group-label">语言：</span>
          <select
            className="select"
            value={langMode}
            onChange={e => setLangMode(e.target.value)}
            title="默认自动识别。手动选择后将不再自动切换"
          >
            <option value="auto">
              自动{langMode === 'auto' ? `（${effectiveLanguage}）` : ''}
            </option>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          {langMode !== 'auto' && (
            <button
              className="btn btn-ghost"
              onClick={() => setLangMode('auto')}
              title="恢复自动识别"
              style={{ padding: '4px 8px', fontSize: 12 }}
            >
              ↺ 自动
            </button>
          )}
        </div>

        <div className="group" style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={handleSwap} title="交换左右内容">⇄ 交换</button>
          <button className="btn" onClick={handleClear}>清空</button>
          <button className="btn btn-primary" onClick={handlePushToApi} title="将当前内容推送到后端，生成分享链接">
            推送到 API
          </button>
        </div>
      </div>

      {banner && (
        <div className={`banner ${banner.type}`}>{banner.message}</div>
      )}

      <div className="diff-editor-wrap">
        <DiffEditor
          height="100%"
          language={effectiveLanguage}
          original={original}
          modified={modified}
          theme="vs-dark"
          options={{
            renderSideBySide: true,
            originalEditable: true,
            readOnly: false,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: 'on'
          }}
          onMount={(editor) => {
            editor.getModifiedEditor().onDidChangeModelContent(() => {
              setModified(editor.getModifiedEditor().getValue());
            });
            editor.getOriginalEditor().onDidChangeModelContent(() => {
              setOriginal(editor.getOriginalEditor().getValue());
            });
          }}
        />
      </div>
    </div>
  );
}
