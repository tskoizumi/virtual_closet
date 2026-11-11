import { useEffect, useState } from 'react';
import { subscribeSync, setSyncKey, generateSyncKey, syncNow } from '../lib/sync.js';
import { ErrorBox, Spinner } from './ui.jsx';

// クラウド同期の設定（同期キーを共有した端末同士でクローゼットが共有される）
export default function SyncPanel() {
  const [s, setS] = useState(null);
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => subscribeSync(setS), []);
  if (!s) return null;

  const apply = async (key, msg) => {
    if (msg && !confirm(msg)) return;
    setErr(null);
    try {
      await setSyncKey(key);
      setInput('');
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <div className="panel">
      <h4>クラウド同期</h4>
      {!s.key ? (
        <>
          <p className="muted small">
            ONにすると、服・コーデ履歴・設定・写真がサーバー(Cloudflare D1)にも保存され、同じ「同期キー」を入れた端末でクローゼットを共有できます。
          </p>
          <div className="row wrap">
            <button className="btn btn-primary" onClick={() => apply(generateSyncKey())}>同期を始める（新しいキーを発行）</button>
          </div>
          <label className="field" style={{ marginTop: 14 }}>
            <span>別の端末で発行したキーを入れて参加</span>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" />
          </label>
          <button
            className="btn btn-small"
            disabled={!input.trim()}
            onClick={() => apply(input, 'このキーのクローゼットに参加します。この端末のデータもまとめて共有されます。よろしいですか？')}
          >
            参加する
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            同期キーを知っている人は誰でもこのクローゼットを見たり編集したりできます。他人に教えないでください。
          </p>
          <div className="row wrap">
            <code style={{ fontSize: 15, letterSpacing: '.05em', userSelect: 'all' }}>{show ? s.key : '••••-••••-••••-••••-••••'}</code>
            <button className="btn btn-small" onClick={() => setShow(!show)}>{show ? '隠す' : '表示'}</button>
            <button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(s.key).then(() => alert('コピーしました'), () => setShow(true))}>コピー</button>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            {s.status === 'syncing' ? (
              <Spinner label={s.label || '同期中…'} />
            ) : (
              <>
                <button className="btn btn-small" onClick={() => syncNow()}>今すぐ同期</button>
                <span className="muted small">
                  {s.lastSyncAt ? `最終同期: ${new Date(s.lastSyncAt).toLocaleString('ja-JP')}` : 'まだ同期していません'}
                </span>
              </>
            )}
          </div>
          <ErrorBox error={s.error} onRetry={() => syncNow()} />
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => apply('', '同期をOFFにします。この端末のデータは残り、サーバーのデータも消えません。よろしいですか？')}
            >
              同期をOFFにする
            </button>
          </div>
        </>
      )}
      <ErrorBox error={err} />
    </div>
  );
}
