import { useEffect, useState } from 'react';
import Today from './components/Today.jsx';
import Closet from './components/Closet.jsx';
import Shop from './components/Shop.jsx';
import Review from './components/Review.jsx';
import Settings from './components/Settings.jsx';
import { api } from './lib/api.js';
import { restoreQueue } from './lib/uploadQueue.js';
import { startSync } from './lib/sync.js';
import { IconToday, IconCloset, IconShop, IconAdvice, IconSettings } from './components/icons.jsx';

const TABS = [
  { key: 'today', label: '今日', Icon: IconToday },
  { key: 'closet', label: 'クローゼット', Icon: IconCloset },
  { key: 'shop', label: '買い物', Icon: IconShop },
  { key: 'review', label: '相談', Icon: IconAdvice },
  { key: 'settings', label: '設定', Icon: IconSettings },
];

export default function App() {
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'today');
  const [addFiles, setAddFiles] = useState(null);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    const h = () => {
      const t = location.hash.slice(1);
      if (TABS.some((x) => x.key === t)) setTab(t);
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  useEffect(() => {
    location.hash = tab;
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    api('health')
      .then((h) => !h.hasKey && setBanner('サーバーに GEMINI_API_KEY が設定されていません。AI機能は使えません。'))
      .catch(() => setBanner('サーバーに接続できません。AI機能は使えません。'));
    if (navigator.storage?.persist) navigator.storage.persist();
    restoreQueue();
    startSync();
  }, []);

  return (
    <div className="app">
      <header className="top">
        <span className="brand">CLOSET</span>
      </header>
      {banner && <div className="banner">{banner}</div>}
      <main>
        {tab === 'today' && <Today goCloset={() => setTab('closet')} />}
        {tab === 'closet' && <Closet addFiles={addFiles} onAddHandled={() => setAddFiles(null)} />}
        {tab === 'shop' && <Shop onBought={(f) => { setAddFiles([f]); setTab('closet'); }} />}
        {tab === 'review' && <Review />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            <span className="nav-icon"><t.Icon /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
