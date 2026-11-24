/**
 * Spoken navigation phrases. Fixed templates, never an LLM: a driving prompt must be instant and must never be reworded
 * wrongly. English re-uses the backend's own instruction text (src/directions.py); Hindi is built here from the step's
 * manoeuvre, side, exit number and street. THE HINDI TEMPLATES ARE FOR THE OWNER TO REVIEW (phase U5 report).
 */
import type { HotspotEvent, NavStep } from '@/api/schemas';

export type NavLanguage = 'en' | 'hi';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const MERGE = ', then ';
const isMerged = (step: NavStep) => step.instruction_en.includes(MERGE);

// ---- Hindi building blocks (owner to review) ---------------------------------------------------------------------

export const HI = {
  turn: { left: 'बाएं मुड़ें', right: 'दाएं मुड़ें' },
  slight: { left: 'हल्का बाएं मुड़ें', right: 'हल्का दाएं मुड़ें' },
  sharp: { left: 'तेज़ बाएं मुड़ें', right: 'तेज़ दाएं मुड़ें' },
  uturn: 'यू-टर्न लें',
  continue: 'सीधे चलते रहें',
  roundaboutNoExit: 'गोल चक्कर से गुज़रें',
  roundabout: (ordinal: string) => `गोल चक्कर पर ${ordinal} निकास लें`,
  ordinals: ['', 'पहला', 'दूसरा', 'तीसरा', 'चौथा', 'पाँचवाँ', 'छठा'],
  onStreet: (street: string) => `${street} पर`,
  inMetres: (n: number, action: string) => `${n} मीटर बाद, ${action}`,
  now: (action: string) => `अब ${action}`,
  head: (dir: string, street: string | null) => (street ? `${street} पर ${dir} की ओर चलें` : `${dir} की ओर चलें`),
  compass: ['उत्तर', 'उत्तर-पूर्व', 'पूर्व', 'दक्षिण-पूर्व', 'दक्षिण', 'दक्षिण-पश्चिम', 'पश्चिम', 'उत्तर-पश्चिम'],
  arrive: (name: string) => (name ? `आप ${name} पहुँच गए हैं।` : 'आप अपनी मंज़िल पर पहुँच गए हैं।'),
  side: { left: 'बाएं', right: 'दाएं', on_route: 'आगे' },
  tier: { RED: 'रेड', YELLOW: 'येलो', GREEN: 'ग्रीन', LOW_RAIN: 'कम बारिश' },
  hotspotAvoided: (name: string, tier: string, side: string) =>
    `${name} ${tier} श्रेणी में है और आपके ${side} है। आपका रास्ता आपको उससे दूर रखता है।`,
  hotspotThrough: (name: string, tier: string) =>
    `आप ${name} के पास पहुँच रहे हैं, जो ${tier} श्रेणी में है। इससे बचने के लिए कोई और रास्ता नहीं है।`,
  preview: 'यह सामान्य रास्ते का पूर्वावलोकन है।',
} as const;

const compassIndex = (bearing: number) => Math.floor((((bearing % 360) + 360) % 360 + 22.5) / 45) % 8;

/** The manoeuvre alone ("turn left"), with the street when asked and when the step is not a merged pair. */
function actionHindi(step: NavStep, withStreet: boolean): string {
  const side = step.modifier === 'right' ? 'right' : 'left';
  const street = withStreet && !isMerged(step) && step.street ? HI.onStreet(step.street) : '';
  let core: string;
  switch (step.maneuver) {
    case 'turn':
      core = HI.turn[side];
      break;
    case 'slight':
      core = HI.slight[side];
      break;
    case 'sharp':
      core = HI.sharp[side];
      break;
    case 'uturn':
      core = HI.uturn;
      break;
    case 'roundabout':
      core = step.exit_number && step.exit_number <= 6 ? HI.roundabout(HI.ordinals[step.exit_number]) : HI.roundaboutNoExit;
      break;
    default:
      core = HI.continue;
  }
  return street ? `${street} ${core}` : core;
}

/** English action with the street ("turn left onto Golf Course Road"); a merged pair keeps both ("..., then ..."). */
function actionEnglish(step: NavStep, withStreet: boolean): string {
  if (withStreet) return lowerFirst(step.instruction_en);
  const first = step.instruction_en.split(MERGE)[0];
  return lowerFirst(first.replace(/ onto .+$/, ''));
}

const sentence = (s: string, end = '.') => (/[.!?।]$/.test(s) ? s : `${s}${end}`);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Phrases = {
  /** "In 500 metres, turn left onto X." */
  inMetres(step: NavStep, metres: number): string;
  /** "Turn left now." */
  now(step: NavStep): string;
  /** "Head north on X." */
  depart(step: NavStep): string;
  arrive(destinationName: string): string;
  /** What is said when a hotspot the route keeps clear of comes up, or null when nothing should be said. */
  hotspot(event: HotspotEvent): string | null;
  preview: string;
};

export function phrases(language: NavLanguage): Phrases {
  if (language === 'hi') {
    return {
      inMetres: (step, metres) => sentence(upperFirst(HI.inMetres(metres, actionHindi(step, true))), '।'),
      now: (step) =>
        sentence(step.maneuver === 'roundabout' || step.maneuver === 'continue' ? actionHindi(step, false) : HI.now(actionHindi(step, false)), '।'),
      depart: (step) =>
        sentence(HI.head(HI.compass[compassIndex(step.bearing_after ?? 0)], step.street), '।'),
      arrive: (name) => HI.arrive(name),
      hotspot: (e) =>
        e.avoided
          ? HI.hotspotAvoided(e.name, HI.tier[e.tier], HI.side[e.side])
          : e.passes_through
            ? HI.hotspotThrough(e.name, HI.tier[e.tier])
            : null,
      preview: HI.preview,
    };
  }
  return {
    inMetres: (step, metres) => sentence(`In ${metres} metres, ${actionEnglish(step, true)}`),
    now: (step) =>
      step.maneuver === 'continue'
        ? sentence(step.instruction_en.split(MERGE)[0]) // "Continue onto Sohna Road." (a road change, not a turn)
        : sentence(step.maneuver === 'roundabout' ? upperFirst(actionEnglish(step, false)) : `${upperFirst(actionEnglish(step, false))} now`),
    depart: (step) => sentence(step.instruction_en),
    arrive: (name) => (name ? `You have arrived at ${name}.` : 'You have arrived at your destination.'),
    hotspot: (e) => {
      const where = e.side === 'on_route' ? 'ahead' : `to your ${e.side}`;
      if (e.avoided) return `${e.name}, rated ${e.tier}, is ${where}. Your route keeps you clear of it.`;
      if (e.passes_through) return `You are approaching ${e.name}, rated ${e.tier}. No other road avoids it.`;
      return null;
    },
    preview: 'This is a preview of the usual route.',
  };
}
