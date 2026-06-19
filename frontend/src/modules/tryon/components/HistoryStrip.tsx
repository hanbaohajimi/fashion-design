interface HistoryEntry {
  id: string;
  image_url: string;
  created_at: number;
}

interface HistoryStripProps {
  history: HistoryEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export default function HistoryStrip({ history, activeId, onSelect }: HistoryStripProps) {
  if (!history.length) return null;
  return (
    <div className="tryon-history">
      <span className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em' }}>
        Recent &middot; {history.length}
      </span>
      {history.map(h => {
        const on = h.id === activeId;
        return (
          <button
            key={h.id}
            type="button"
            onClick={() => onSelect(h.id)}
            className={`tryon-history-item${on ? ' is-active' : ''}`}
            title={new Date(h.created_at).toLocaleTimeString()}
          >
            <img src={h.image_url} alt="" />
          </button>
        );
      })}
    </div>
  );
}
