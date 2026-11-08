import { useEffect, useState } from 'react';
import { db, newId } from '../lib/db.js';
import { subscribe, enqueue, retry, dismiss, clearFinished, jobImages } from '../lib/uploadQueue.js';
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

  const done = jobs.filter((j) => j.status === 'done').length;
  const working = jobs.filter((j) => j.status === 'working' || j.status === 'waiting').length;
  const failed = jobs.filter((j) => j.status === 'error').length;

  return (
    <div className="add">
      <p className="muted">
        写真をまとめて選ぶだけでOK。切り抜きとAI解析は裏で進めて、終わったものから自動でクローゼットに登録します（この画面を閉じても続きます）。内容はあとからタップで編集できます。
      </p>
      <div className="row">
        <FilePick label="📷 撮影" capture="environment" onFiles={enqueue} className="btn btn-primary" />
        <FilePick label="🖼 写真から選ぶ（複数OK）" multiple onFiles={enqueue} className="btn" />
      </div>

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
            {jobs.map((j) => {
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
                    <div className="job-name">{item ? item.name : j.item ? `${j.item.name}：${j.label}` : j.label}</div>
                    {j.note && <div className="job-note">元の写真で登録（編集から再生成できます）</div>}
                  </button>
                  {(j.status === 'working' || j.status === 'waiting') && <Spinner />}
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
            initial={editing.item || jobImages(editing.jobId).item || {}}
            image={editing.item ? editing.item.image : jobImages(editing.jobId).image}
            onCancel={() => setEditing(null)}
            onSave={async (f) => {
              if (editing.item) {
                const { id, ...rest } = f;
                await db.items.update(editing.item.id, { ...rest, unchecked: false });
                setItems((m) => ({ ...m, [editing.item.id]: { ...editing.item, ...rest } }));
              } else {
                const imgs = jobImages(editing.jobId);
                await db.items.add({ ...f, id: newId(), image: f.image || imgs.image, original: f.original || imgs.original, createdAt: Date.now(), wearCount: 0, lastWornAt: null });
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
