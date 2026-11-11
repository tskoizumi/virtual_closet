import { useEffect, useState } from 'react';
import { db, newId } from '../lib/db.js';
import { subscribe, enqueue, retry, dismiss, clearFinished, jobImages, confirmGroup, confirmAll } from '../lib/uploadQueue.js';
import { ROLE_LABEL } from '../lib/productPhoto.js';
import ItemEditor from './ItemEditor.jsx';
import { BlobImg, FilePick, Modal, Spinner, usePaste, useBlobUrl } from './ui.jsx';

export function useUploadJobs() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => subscribe(setJobs), []);
  return jobs;
}

function JobThumb({ job, item }) {
  const fileUrl = useBlobUrl(job.image ? null : job.file);
  return (
    <div className="job-img">
      {item ? <BlobImg blob={item.image} /> : job.image ? <BlobImg blob={job.image} /> : fileUrl ? <img src={fileUrl} alt="" /> : null}
    </div>
  );
}

function Photo({ blob, children, off, onClick }) {
  const url = useBlobUrl(blob);
  return (
    <button type="button" className={`confirm-photo ${off ? 'is-off' : ''}`} onClick={onClick} disabled={!onClick}>
      {url && <img src={url} alt="" />}
      {children}
    </button>
  );
}

// 「この写真は同じ服ですか？」の確認カード
function ConfirmGroup({ job }) {
  const extras = job.extras || [];
  const [keep, setKeep] = useState(() => extras.map(() => true));
  const kept = keep.filter(Boolean).length;
  return (
    <div className="confirm-card">
      <p className="confirm-q">
        この{extras.length + 1}枚は同じ服ですか？
        {job.groupName && <span className="muted small">（AIの判断: {job.groupName}）</span>}
      </p>
      <p className="muted small">違う写真はタップして外してください。外した写真は別のアイテムとして登録します。</p>
      <div className="confirm-photos">
        <Photo blob={job.file}><span className="confirm-role">メイン</span></Photo>
        {extras.map((x, i) => (
          <Photo key={i} blob={x.file || x.image} off={!keep[i]} onClick={() => setKeep((k) => k.map((v, j) => (j === i ? !v : v)))}>
            <span className="confirm-role">{keep[i] ? x.label || ROLE_LABEL[x.role] : '別の服'}</span>
          </Photo>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn btn-small btn-primary" onClick={() => confirmGroup(job.id, keep.flatMap((v, i) => (v ? [i] : [])))}>
          {kept === extras.length ? 'はい、同じ服' : kept === 0 ? '全部別々に登録' : `${kept + 1}枚を同じ服として登録`}
        </button>
        {kept > 0 && <button className="btn btn-small btn-ghost" onClick={() => confirmGroup(job.id, [])}>全部別々の服</button>}
      </div>
    </div>
  );
}

// 写真を選ぶと裏で一括処理 → 終わったものから自動でクローゼットに登録。あとから編集できる
export default function AddItem({ initialFiles = [], onClose }) {
  const jobs = useUploadJobs();
  const [editing, setEditing] = useState(null); // { item } or { jobId, manual }
  const [items, setItems] = useState({});

  useEffect(() => {
    if (initialFiles.length) enqueue(initialFiles);
  }, []); // eslint-disable-line

  useEffect(() => {
    const ids = jobs.filter((j) => j.itemId && !items[j.itemId]).map((j) => j.itemId);
    if (ids.length) db.items.bulkGet(ids).then((list) => setItems((m) => ({ ...m, ...Object.fromEntries(list.filter(Boolean).map((i) => [i.id, i])) })));
  }, [jobs]); // eslint-disable-line

  usePaste((f) => enqueue([f]));

  const confirming = jobs.filter((j) => j.status === 'confirm');
  const done = jobs.filter((j) => j.status === 'done').length;
  const working = jobs.filter((j) => ['working', 'waiting', 'grouping'].includes(j.status)).length;
  const failed = jobs.filter((j) => j.status === 'error').length;

  return (
    <div className="add">
      <p className="muted">
        写真をまとめて選ぶだけでOK。同じ服の別角度・裏地やボタンのアップ・タグ・着こなし見本の写真が混ざっていても、AIが1点にまとめます。解析と撮影は裏で進めて、終わったものから自動でクローゼットに登録します（この画面を閉じても続きます）。内容はあとからタップで編集できます。
      </p>
      <div className="row">
        <FilePick label="📷 撮影" capture="environment" onFiles={enqueue} className="btn btn-primary" />
        <FilePick label="🖼 写真から選ぶ（複数OK）" multiple onFiles={enqueue} className="btn" />
      </div>

      {confirming.length > 0 && (
        <div className="confirm-list">
          {confirming.map((j) => <ConfirmGroup key={j.id} job={j} />)}
          {confirming.length > 1 && <button className="btn btn-small" onClick={confirmAll}>すべてAIの判断どおりにまとめる</button>}
        </div>
      )}

      {jobs.length > 0 && (
        <>
          <div className="job-summary">
            <div className="progress"><span style={{ width: `${(done / jobs.length) * 100}%` }} /></div>
            <span className="small">
              登録済み {done} / {jobs.length}
              {working > 0 && ` ・ 処理中 ${working}`}
              {failed > 0 && ` ・ 失敗 ${failed}`}
            </span>
            {done > 0 && working === 0 && <button className="btn btn-small btn-ghost" onClick={clearFinished}>完了分を消す</button>}
          </div>
          <div className="job-grid">
            {jobs.filter((j) => j.status !== 'confirm').map((j) => {
              const item = j.itemId ? items[j.itemId] : null;
              return (
                <div key={j.id} className={`job job-${j.status}`}>
                  <button
                    type="button"
                    className="job-tap"
                    disabled={!item}
                    onClick={() => item && setEditing({ item })}
                  >
                    <JobThumb job={j} item={item} />
                    {j.extras?.length > 0 && <span className="job-count">{j.extras.length + 1}枚</span>}
                    <div className="job-name">{item ? item.name : j.item ? `${j.item.name}：${j.label}` : j.label}</div>
                    {j.note && <div className="job-note">元の写真で登録（編集から再生成できます）</div>}
                  </button>
                  {(['working', 'waiting', 'grouping'].includes(j.status)) && <Spinner />}
                  {j.status === 'error' && (
                    <div className="job-err">
                      <p className="small">{j.error}</p>
                      <div className="row wrap">
                        <button className="btn btn-small" onClick={() => retry(j.id)}>再試行</button>
                        <button className="btn btn-small" onClick={() => setEditing({ jobId: j.id })}>手入力</button>
                        <button className="btn btn-small btn-ghost" onClick={() => dismiss(j.id)}>削除</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {working === 0 && <button className="btn btn-primary btn-block" onClick={onClose}>クローゼットを見る</button>}
        </>
      )}

      {editing && (
        <Modal title="アイテムを編集" onClose={() => setEditing(null)}>
          <ItemEditor
            initial={editing.item || { ...(jobImages(editing.jobId).item || {}), gallery: jobImages(editing.jobId).gallery }}
            image={editing.item ? editing.item.image : jobImages(editing.jobId).image}
            onCancel={() => setEditing(null)}
            onSave={async (f) => {
              if (editing.item) {
                const { id, ...rest } = f;
                await db.items.update(editing.item.id, { ...rest, unchecked: false });
                setItems((m) => ({ ...m, [editing.item.id]: { ...editing.item, ...rest } }));
              } else {
                const imgs = jobImages(editing.jobId);
                await db.items.add({ ...imgs.extra, ...f, id: newId(), image: f.image || imgs.image, original: f.original || imgs.original, createdAt: Date.now(), wearCount: 0, lastWornAt: null });
                dismiss(editing.jobId);
              }
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
