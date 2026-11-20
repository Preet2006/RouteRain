import type { Hotspot } from '@/api/schemas';
import { tierInfo } from '@/theme';

import { probabilityBand, reportedOutcomeText } from './markers';

type Props = { hotspot: Hotspot; replay: boolean; onClose: () => void };

/** Name, tier word, probability band, the explanation sentence, coordinates and (replay) what was reported. */
export function HotspotDetails({ hotspot: h, replay, onClose }: Props) {
  const t = tierInfo(h.tier);
  const band = probabilityBand(h.probability);
  return (
    <section className="rr-card rr-details" aria-label={`${h.name} details`}>
      <div className="rr-details-head">
        <h2>{h.name}</h2>
        <button className="rr-btn" onClick={onClose} aria-label={`Close ${h.name} details`}>Close</button>
      </div>
      <p><span className={`rr-tier ${h.tier}`}><span aria-hidden="true">{t.glyph}</span> {t.label}</span></p>
      <p>{h.explanation}</p>
      <ul className="rr-rows">
        <li><span>Estimated risk</span><span>{band ? `about ${band}` : 'Not scored'}</span></li>
        <li><span>Location</span><span>{h.lat.toFixed(5)}, {h.lon.toFixed(5)}</span></li>
      </ul>
      {replay && (
        <p className="rr-reported">
          <b>Reported that day:</b> {reportedOutcomeText(h)}
          <small className="rr-muted"> This is what was recorded, separate from the prediction above.</small>
        </p>
      )}
    </section>
  );
}
