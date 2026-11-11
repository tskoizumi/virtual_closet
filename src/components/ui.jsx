import { useEffect, useState } from 'react';
import { IconClose } from './icons.jsx';

export function useBlobUrl(blob) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function Thumb({ item, size = 'md', onClick, selected, badge }) {
  const url = useBlobUrl(item?.image);
  return (
    <button type="button" className={`thumb thumb-${size} ${selected ? 'is-selected' : ''}`} onClick={onClick} disabled={!onClick}>
      {url ? <img src={url} alt={item?.name || ''} loading="lazy" /> : <span className="thumb-missing">削除済み</span>}
      {badge && <span className="thumb-badge">{badge}</span>}
    </button>
  );
}

export function BlobImg({ blob, alt = '', className }) {
  const url = useBlobUrl(blob);
  return url ? <img src={url} alt={alt} className={className} /> : null;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', h);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる"><IconClose /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="spinner-row">
      <span className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-box">
      <strong>エラー</strong>
      <p>{String(error.message || error)}</p>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>もう一度</button>}
    </div>
  );
}

export function Chips({ options, value, onChange, multi }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const key = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const active = multi ? value.includes(key) : value === key;
        return (
          <button
            type="button"
            key={key}
            className={`chip ${active ? 'is-active' : ''}`}
            onClick={() => {
              if (multi) onChange(active ? value.filter((v) => v !== key) : [...value, key]);
              else onChange(active ? '' : key);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function FilePick({ label, onFiles, multiple, capture, className = 'btn' }) {
  return (
    <label className={className}>
      {label}
      <input
        type="file"
        accept="image/*"
        hidden
        multiple={multiple}
        capture={capture}
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

// 画像を貼り付け（Ctrl+V / iOSの長押しペースト）でも受け付ける
export function usePaste(onFile) {
  useEffect(() => {
    const h = (e) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) onFile(f);
    };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, [onFile]);
}
