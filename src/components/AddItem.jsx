import { useCallback, useEffect, useRef, useState } from 'react';
import { db, newId, getProfile } from '../lib/db.js';
import { resize, removeBg, trimTransparent, forAI } from '../lib/image.js';
import { api } from '../lib/api.js';
import ItemEditor from './ItemEditor.jsx';
import { ErrorBox, FilePick, Spinner, usePaste } from './ui.jsx';

// 登録フロー: 撮影 → 背景切り抜き → AIタグ付け → 確認・修正 → 保存 → 次へ
export default function AddItem({ initialFiles = [], onClose }) {
  const [queue, setQueue] = useState(initialFiles);
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState('idle'); // idle | cut | tag | edit | error
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [errorAt, setErrorAt] = useState(null); // 'cut' | 'tag'
  const [work, setWork] = useState({});
  const [saved, setSaved] = useState(0);
  const runId = useRef(0);

  const file = queue[idx];

  const run = useCallback(
    async (opts = {}) => {
      if (!file) return;
      const my = ++runId.current;
      setError(null);
      try {
        const profile = await getProfile();
        let original = work.original;
        let image = work.image;
        if (!original) original = await resize(file, 1600, { type: 'image/jpeg', quality: 0.88 });
        if (!image) {
          if (profile.useCutout && !opts.skipCut) {
            setStage('cut');
            setProgress('背景を切り抜き中…');
            try {
              const cut = await removeBg(original, (key, cur, total) => {
                if (key.includes('fetch') && total) setProgress(`切り抜きモデルを読み込み中（初回のみ） ${Math.round((cur / total) * 100)}%`);
                else setProgress('背景を切り抜き中…');
              });
              image = await resize(await trimTransparent(cut), 900, { type: 'image/png' });
            } catch (e) {
              setErrorAt('cut');
              throw e;
            }
          } else {
            image = await resize(original, 900, { type: 'image/jpeg', quality: 0.88 });
          }
        }
        if (my !== runId.current) return;
        setWork({ original, image });
        if (opts.manual) {
          setWork({ original, image, tags: {} });
          setStage('edit');
          return;
        }
        setStage('tag');
        setProgress('AIがアイテムを解析中…');
        try {
          const { item } = await api('tag', { image: await forAI(image) });
          if (my !== runId.current) return;
          setWork({ original, image, tags: item });
          setStage('edit');
        } catch (e) {
          setErrorAt('tag');
          throw e;
        }
      } catch (e) {
        if (my !== runId.current) return;
        setError(e);
        setStage('error');
      }
    },
    [file, work]
  );

  useEffect(() => {
    if (file && stage === 'idle') run();
  }, [file, stage, run]);

  const addFiles = useCallback((files) => {
    setQueue((q) => [...q, ...files]);
  }, []);
  usePaste(useCallback((f) => addFiles([f]), [addFiles]));

  const next = () => {
    setWork({});
    setError(null);
    setStage('idle');
    setIdx((i) => i + 1);
  };

  const save = async (fields) => {
    await db.items.add({
      ...fields,
      id: newId(),
      image: fields.image || work.image,
      original: fields.original || work.original,
      createdAt: Date.now(),
      wearCount: 0,
      lastWornAt: null,
    });
    setSaved((s) => s + 1);
    next();
  };

  const remaining = queue.length - idx;

  return (
    <div className="add">
      <div className="add-head">
        <p className="muted">
          1枚に1アイテムを写すのがコツ。床や壁など無地の背景だと切り抜き精度が上がります。
          {saved > 0 && <strong> このセッションで{saved}点登録済み</strong>}
        </p>
        <div className="row">
          <FilePick label="📷 撮影" capture="environment" onFiles={addFiles} className="btn btn-primary" />
          <FilePick label="🖼 写真から選ぶ（複数OK）" multiple onFiles={addFiles} className="btn" />
        </div>
        {remaining > 1 && <p className="muted small">残り {remaining - 1} 枚が待機中</p>}
      </div>

      {!file && queue.length > 0 && (
        <div className="done-box">
          <p>キューの写真はすべて処理しました。</p>
          <button className="btn btn-primary" onClick={onClose}>クローゼットへ戻る</button>
        </div>
      )}

      {file && (stage === 'cut' || stage === 'tag' || stage === 'idle') && <Spinner label={progress || '準備中…'} />}

      {file && stage === 'error' && (
        <div>
          <ErrorBox error={error} onRetry={() => { setWork(errorAt === 'cut' ? {} : work); setStage('idle'); }} />
          <div className="row">
            {errorAt === 'cut' && (
              <button className="btn" onClick={() => { setWork({}); run({ skipCut: true }); }}>切り抜かずに続ける</button>
            )}
            {errorAt === 'tag' && (
              <button className="btn" onClick={() => run({ manual: true })}>AIなしで手入力する</button>
            )}
            <button className="btn btn-ghost" onClick={next}>この写真をスキップ</button>
          </div>
        </div>
      )}

      {file && stage === 'edit' && (
        <ItemEditor
          key={idx}
          initial={work.tags}
          image={work.image}
          onSave={save}
          saveLabel={remaining > 1 ? '保存して次へ' : '保存'}
          extra={<button type="button" className="btn btn-ghost" onClick={next}>スキップ</button>}
        />
      )}
    </div>
  );
}
