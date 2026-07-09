/**
 * Trend Analysis module — debug utilities
 *
 * shouldShowLegacyTrendFrame()
 * ─────────────────────────────
 * Controls visibility of the Legacy Trend iframe panel.
 *
 * BACKGROUND
 * The trend-analysis module has been fully migrated to React:
 *   - Pipeline controls, WebSocket / polling state → React
 *   - Report list                                  → React (TrendReportList)
 *   - Report detail                                → React (TrendReportDetail)
 *
 * The legacy page at localhost:8002 (services/trend/frontend/) is kept as a
 * fallback / debug reference only. It is served via FastAPI StaticFiles and
 * is still fully functional when opened standalone. When embedded via iframe
 * it receives ?embedded=1, which suppresses its own WebSocket connection so it
 * doesn't compete with the React layer.
 *
 * DEFAULT BEHAVIOUR
 * This function returns false in all normal circumstances. The "Legacy Preview"
 * button and iframe are therefore not rendered for regular users.
 *
 * HOW TO ENABLE (two methods)
 *
 *   1. Vite environment variable (persists across page loads, team-visible):
 *        VITE_SHOW_LEGACY_TREND_IFRAME=true   ← add to your local .env file
 *      Then restart the dev server: npm run dev
 *
 *   2. URL query parameter (per-session, no restart needed):
 *        http://localhost:3100/?debugLegacyTrend=1
 *      Removing the query or closing the tab reverts the behaviour.
 *
 * Neither flag should ever be set in a production / shared environment.
 */
export function shouldShowLegacyTrendFrame(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((import.meta as any).env?.VITE_SHOW_LEGACY_TREND_IFRAME === 'true') return true;
  try {
    return new URLSearchParams(window.location.search).get('debugLegacyTrend') === '1';
  } catch {
    return false;
  }
}
