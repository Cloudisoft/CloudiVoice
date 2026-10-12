/** Shown instantly on every dashboard navigation while the page loads. */
export default function Loading() {
  return (
    <div className="skel-page" role="status" aria-live="polite" aria-label="Loading">
      <div className="skel skel-title" />
      <div className="skel skel-sub" />
      <div className="skel-stats">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skel skel-stat" />
        ))}
      </div>
      <div className="skel-grid">
        <div className="skel skel-panel" />
        <div className="skel skel-panel skel-panel-side" />
      </div>
    </div>
  );
}
