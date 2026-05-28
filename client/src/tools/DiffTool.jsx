import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DiffEditor } from '@monaco-editor/react';

const LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'json', 'html', 'css',
  'markdown', 'python', 'java', 'go', 'sql', 'xml', 'yaml', 'shell'
];

// 简单根据扩展名推断语言
function detectLang(filename = '') {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json',
    html: 'html', htm: 'html',
    css: 'css', scss: 'css', less: 'css',
    md: 'markdown', markdown: 'markdown',
    py: 'python',
    java: 'java',
    go: 'go',
    sql: 'sql',
    xml: 'xml',
    yml: 'yaml', yaml: 'yaml',
    sh: 'shell', bash: 'shell'
  };
  return map[ext] || 'plaintext';
}

export default function DiffTool() {
  const [searchParams] = useSearchParams();
  const apiId = searchParams.get('id');

  const [original, setOriginal] = useState('// 原始内容（左侧）\n// 选择本地文件，或通过 API /api/diff/push 推送数据\n');
  const [modified, setModified] = useState('// 修改后内容（右侧）\n');
  const [language, setLanguage] = useState('javascript');
  const [originalName, setOriginalName] = useState('');
  const [modifiedName, setModifiedName] = useState('');
  const [banner, setBanner] = useState(null); // { type, message }

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

  const readFile = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }, []);

  const handlePickOriginal = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFile(file);
      setOriginal(text);
      setOriginalName(file.name);
      setLanguage(detectLang(file.name));
      setBanner({ type: 'success', message: `已加载原始文件：${file.name}` });
    } catch (err) {
      setBanner({ type: 'error', message: '读取文件失败：' + err.message });
    } finally {
      e.target.value = '';
    }
  };

  const handlePickModified = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFile(file);
      setModified(text);
      setModifiedName(file.name);
      // 只有原始未推断语言时才用修改文件推断
      if (!originalName) setLanguage(detectLang(file.name));
      setBanner({ type: 'success', message: `已加载修改文件：${file.name}` });
    } catch (err) {
      setBanner({ type: 'error', message: '读取文件失败：' + err.message });
    } finally {
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
          <button className="btn" onClick={() => originalInputRef.current?.click()}>选择本地文件</button>
          <input
            ref={originalInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handlePickOriginal}
          />
          {originalName && <span className="file-info">{originalName}</span>}
        </div>

        <div className="group">
          <span className="group-label">修改：</span>
          <button className="btn" onClick={() => modifiedInputRef.current?.click()}>选择本地文件</button>
          <input
            ref={modifiedInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handlePickModified}
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
            scrollBeyondLastLine: false
          }}
          onMount={(editor) => {
            // 监听 modified 编辑器变化
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
