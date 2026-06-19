import { useState } from 'react';
import { Upload, X } from 'lucide-react';

interface Props {
  onUpload: (files: FileList | File[]) => void;
  onClose: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}

export default function UploadModal({ onUpload, onClose, fileRef }: Props) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="wardrobe-upload-overlay" onClick={onClose}>
      <div
        className="wardrobe-upload-card"
        onClick={e => e.stopPropagation()}
      >
        <div className="wardrobe-upload-head">
          <div>
            <div className="wardrobe-upload-kicker">Upload · 上传衣物</div>
            <h3 className="wardrobe-upload-title">Add to your atelier</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="wardrobe-drawer-x"
            aria-label="关闭"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div
          className={`wardrobe-upload-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); onUpload(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-8 h-8" strokeWidth={1.2} style={{ color: 'var(--color-ink-3)' }} />
          <p className="wardrobe-upload-primary">拖放图片到这里，或点击选择文件</p>
          <p className="wardrobe-upload-hint">JPG · PNG · WebP · AI auto-tagged</p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => e.target.files && onUpload(e.target.files)}
        />
      </div>
    </div>
  );
}
