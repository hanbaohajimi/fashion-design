import { memo } from 'react';
import { Check } from 'lucide-react';

interface PresetCardProps {
  imageUrl: string;
  name: string;
  selected?: boolean;
  onClick?: () => void;
  badge?: { text: string; color?: string } | null;
  /** size in px for the card */
  size?: number;
  /** Optional overlay (e.g. "图 1"). Renders bottom-right. */
  cornerOverlay?: string;
}

function PresetCardImpl({ imageUrl, name, selected, onClick, badge, size = 96, cornerOverlay }: PresetCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tryon-preset-card${selected ? ' is-selected' : ''}`}
      style={{ width: size }}
      title={name}
    >
      <div className="tryon-preset-img">
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          onError={e => {
            (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
          }}
        />
      </div>
      <div className="tryon-preset-name">{name}</div>
      {badge && (
        <span className="tryon-preset-badge">
          {badge.text}
        </span>
      )}
      {selected && (
        <span className="tryon-preset-check">
          <Check className="h-3 w-3" strokeWidth={1.5} />
        </span>
      )}
      {cornerOverlay && (
        <span className="tryon-preset-corner">{cornerOverlay}</span>
      )}
    </button>
  );
}

const PresetCard = memo(PresetCardImpl);
export default PresetCard;
