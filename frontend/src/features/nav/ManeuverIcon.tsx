import type { NavStep } from '@/api/schemas';

type Props = { step: Pick<NavStep, 'maneuver' | 'modifier'>; size?: number };

/** Angle of the arrow head, degrees clockwise from "straight ahead". */
function angleFor({ maneuver, modifier }: Props['step']): number {
  const sign = modifier === 'left' ? -1 : 1;
  switch (maneuver) {
    case 'turn':
      return 90 * sign;
    case 'slight':
      return 45 * sign;
    case 'sharp':
      return 135 * sign;
    default:
      return 0;
  }
}

/** The big arrow in the navigation banner. Decorative: the instruction text beside it carries the meaning. */
export function ManeuverIcon({ step, size = 64 }: Props) {
  const common = { width: size, height: size, viewBox: '0 0 48 48', 'aria-hidden': true as const, focusable: false as const, className: 'rr-drive-icon' };
  const stroke = { stroke: 'currentColor', strokeWidth: 5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  if (step.maneuver === 'arrive') {
    return (
      <svg {...common} data-maneuver="arrive">
        <path d="M14 42V8" {...stroke} />
        <path d="M14 9h22l-6 8 6 8H14z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    );
  }
  if (step.maneuver === 'uturn') {
    const flip = step.modifier === 'right' ? 'translate(48 0) scale(-1 1)' : undefined;
    return (
      <svg {...common} data-maneuver="uturn">
        <g transform={flip}>
          <path d="M34 42V20a10 10 0 0 0-20 0v6" {...stroke} />
          <path d="M6 24l8 10 8-10z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
        </g>
      </svg>
    );
  }
  if (step.maneuver === 'roundabout') {
    return (
      <svg {...common} data-maneuver="roundabout">
        <circle cx="24" cy="26" r="9" {...stroke} />
        <path d="M24 44v-9" {...stroke} />
        <path d="M24 17V6" {...stroke} />
        <path d="M17 12l7-8 7 8z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    );
  }
  const angle = angleFor(step);
  return (
    <svg {...common} data-maneuver={step.maneuver} data-angle={angle}>
      <path d="M24 44V24" {...stroke} />
      <g transform={`translate(24 24) rotate(${angle})`}>
        <path d="M0 0V-14" {...stroke} />
        <path d="M-9 -12L0 -23L9 -12z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      </g>
    </svg>
  );
}
