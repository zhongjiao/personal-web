import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DiffEditor } from '@monaco-editor/react';
import { parseFile, detectLanguage } from '../utils/fileParser.js';

const LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'json', 'html', 'css',
  'markdown', 'python', 'java', 'go', 'sql', 'xml', 'yaml', 'shell'
];

// 文件选择 accept：文本类 + docx/pdf/doc
const FILE_ACCEPT = [
  '.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yml', '.yaml',
  '.py', '.java', '.go', '.sql', '.sh', '.csv', '.log',
  '.doc', '.docx', '.pdf'
].join(',');

export default function DiffTool() {
  const [searchParams] = useSearchParams();
  const apiId = searchParams.get('id');

  const [original, setOriginal] = useState('// 原始内容（左侧）\n// 支持 txt / md / 代码 / docx / pdf 等格式\n');
  const [modified, setModified] = useState('// 修改后内容（右侧）\n');
  const [language, setLanguage] = useState('javascript');
  const [originalName, setOriginalName] = useState('');
  const [modifiedName, setModifiedName] = useState('');
  const [banner, setBanner] = useState(null); // { type, message }
  const [loading, setLoading] = useState(false);

  const originalInputRef = useRef(null);
  const modifiedInputRef = useRef(null);

  // ---- 通过 URL ?id=xxx 从后端拉取数据 ----
  useEffect(() => {
    if (!apiId) return;
    fetch(`/api/diff/pull/${encodeURIComponent(apiId)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          setOriginal(json.data.original || '');
          setModified(json.data.modified || '');
          if (json.data.language) setLanguage(json.data.language);
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
      const { text, language: lang, kind, warning } = await parseFile(file);
      if (side === 'original') {
        setOriginal(text);
        setOriginalName(file.name);
        // docx/pdf 不覆盖语言为 plaintext，除非当前是 plaintext / 用户首次上传
        if (kind === 'text') setLanguage(lang);
        else if (!modifiedName) setLanguage('plaintext');
      } else {
        setModified(text);
        setModifiedName(file.name);
        if (kind === 'text' && !originalName) setLanguage(lang);
        else if (!originalName) setLanguage('plaintext');
      }
      const tag = kind === 'docx' ? '[DOCX]' : kind === 'pdf' ? '[PDF]' : kind === 'doc' ? '[DOC]' : '';
      setBanner({
        type: warning ? 'warning' : 'success',
        message: warning
          ? `${file.name}：${warning}`
          : `已加载 ${tag} ${file.name}（${kind === 'text' ? '文本' : '已转纯文本'}）`
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
  };

  const handleClear = () => {
    setOriginal('');
    setModified('');
    setOriginalName('');
    setModifiedName('');
    setBanner(null);
  };

  // ---- 通过 API 推送当前内容（演示 push 接口） ----
  const handlePushToApi = async () => {
    try {
      const resp = await fetch('/api/diff/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, modified, language })
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
          <select className="select" value={language} onChange={e => setLanguage(e.target.value)}>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
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
          language={language}
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
