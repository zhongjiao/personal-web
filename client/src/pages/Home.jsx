import React from 'react';
import { useNavigate } from 'react-router-dom';
import { tools } from '../toolsRegistry.js';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home">
      <h1>工具集</h1>
      <p className="subtitle">选择一个工具开始使用</p>
      <div className="tools-grid">
        {tools.map(tool => (
          <div
            key={tool.id}
            className="tool-card"
            onClick={() => navigate(tool.path)}
          >
            <div className="tool-icon">{tool.icon}</div>
            <div className="tool-name">{tool.name}</div>
            <div className="tool-desc">{tool.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
