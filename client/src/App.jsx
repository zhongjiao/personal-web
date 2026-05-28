import React from 'react';
import { Routes, Route, Link, NavLink } from 'react-router-dom';
import Home from './pages/Home.jsx';
import DiffTool from './tools/DiffTool.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="logo">PMP 管理平台</Link>
        <nav>
          <NavLink to="/" end>首页</NavLink>
          <NavLink to="/tools/diff">差异对比</NavLink>
        </nav>
      </header>
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tools/diff" element={<DiffTool />} />
          <Route path="*" element={<div style={{ padding: 32 }}>页面不存在</div>} />
        </Routes>
      </main>
    </div>
  );
}
