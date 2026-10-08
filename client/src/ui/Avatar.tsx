import type { ReactNode } from 'react';
import type { AvatarId } from '../../../shared/rules';
import type { Mood } from '../game/session';
import { COLORS, mix } from '../theme';

interface AvatarProps {
  kind: AvatarId;
  color: string;
  mood?: Mood;
  size?: number;
}

const INK = COLORS.choco;
const DOUGH = mix(COLORS.creme, COLORS.citron, 0.32);
const BAKED = mix(COLORS.citron, COLORS.choco, 0.42);
const STROKE = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;

function Face({ x, y, mood }: { x: number; y: number; mood: Mood }): ReactNode {
  const eyes =
    mood === 'ouch' || mood === 'out' ? (
      [-7, 7].map((dx) => (
        <path
          key={dx}
          d={mood === 'ouch' ? `M${x + dx - 3} ${y - 3}l6 6m0-6l-6 6` : `M${x + dx - 3} ${y}h6`}
          fill="none"
          {...STROKE}
          strokeWidth={2.2}
        />
      ))
    ) : (
      [-7, 7].map((dx) => (
        <g key={dx}>
          <circle cx={x + dx} cy={y} r={mood === 'worried' ? 4.4 : 3.6} fill="#fff" stroke={INK} strokeWidth={1.4} />
          <circle cx={x + dx} cy={y + (mood === 'happy' ? -0.6 : 0.8)} r={mood === 'worried' ? 1.3 : 1.9} fill={INK} />
        </g>
      ))
    );
  const mouths: Record<Mood, string> = {
    idle: `M${x - 4} ${y + 7}q4 4 8 0`,
    happy: `M${x - 5} ${y + 6}q5 8 10 0z`,
    worried: `M${x - 5} ${y + 9}q2.5-3 5 0t5 0`,
    ouch: `M${x - 4} ${y + 10}q4-4 8 0`,
    out: `M${x - 4} ${y + 9}h8`,
  };
  return (
    <g>
      {eyes}
      <path d={mouths[mood]} fill={mood === 'happy' ? INK : 'none'} {...STROKE} strokeWidth={2} />
      {mood === 'worried' && <path d={`M${x + 15} ${y - 8}q3 5 0 7q-3-2 0-7z`} fill="#bfe3f5" stroke={INK} strokeWidth={1.2} />}
    </g>
  );
}

const SHAPES: Record<AvatarId, (color: string, mood: Mood) => ReactNode> = {
  chou: (color, mood) => (
    <>
      <ellipse cx="32" cy="43" rx="23" ry="15" fill={DOUGH} {...STROKE} />
      <path d="M11 35q5-6 10-1t11 0t11 0t10 1q-2 7-21 7t-21-7z" fill="#fff" {...STROKE} />
      <ellipse cx="32" cy="23" rx="16" ry="12" fill={DOUGH} {...STROKE} />
      <path d="M20 17q12-12 24 0q-12 5-24 0z" fill={color} {...STROKE} />
      <Face x={32} y={45} mood={mood} />
    </>
  ),
  macaron: (color, mood) => (
    <>
      <path d="M8 46q0-5 6-5h36q6 0 6 5q0 9-24 9t-24-9z" fill={color} {...STROKE} />
      <rect x="9" y="33" width="46" height="9" rx="4.5" fill="#fff" {...STROKE} />
      <path d="M8 31q0-20 24-20t24 20q0 3-6 3h-36q-6 0-6-3z" fill={color} {...STROKE} />
      <Face x={32} y={22} mood={mood} />
    </>
  ),
  eclair: (color, mood) => (
    <>
      <rect x="5" y="22" width="54" height="28" rx="14" fill={DOUGH} {...STROKE} />
      <path d="M8 31q1-11 12-11h24q11 0 12 11q-4 4-8 0t-8 0t-8 0t-8 0t-8 0z" fill={color} {...STROKE} />
      <Face x={32} y={39} mood={mood} />
    </>
  ),
  tartelette: (color, mood) => (
    <>
      <path d="M12 36a20 19 0 0 1 40 0z" fill={color} {...STROKE} />
      <path d="M7 36h50l-6 19h-38z" fill={DOUGH} {...STROKE} />
      <path d="M19 37l2 17m11-17v17m13-17l-2 17" fill="none" {...STROKE} strokeWidth={1.6} opacity={0.5} />
      <circle cx="24" cy="23" r="2.4" fill="#fff" opacity={0.8} />
      <Face x={32} y={28} mood={mood} />
    </>
  ),
  cannele: (color, mood) => (
    <>
      <path d="M15 19h34l5 36h-44z" fill={BAKED} {...STROKE} />
      <path d="M23 20l-3 34m12-34v34m9-34l3 34" fill="none" {...STROKE} strokeWidth={1.6} opacity={0.45} />
      <ellipse cx="32" cy="18" rx="17" ry="6.5" fill={color} {...STROKE} />
      <rect x="18" y="29" width="28" height="18" rx="9" fill={mix(COLORS.creme, COLORS.citron, 0.2)} opacity={0.92} />
      <Face x={32} y={36} mood={mood} />
    </>
  ),
  madeleine: (color, mood) => (
    <>
      <path d="M32 9q24 6 23 28q-1 19-23 19t-23-19q-1-22 23-28z" fill={DOUGH} {...STROKE} />
      <path d="M32 10v12m-11-6l5 10m17-10l-5 10" fill="none" {...STROKE} strokeWidth={1.6} opacity={0.45} />
      <path d="M20 53l-6 6l9 0l3-4m18-2l6 6l-9 0l-3-4" fill={color} {...STROKE} strokeWidth={2} />
      <circle cx="32" cy="54" r="4" fill={color} {...STROKE} strokeWidth={2} />
      <Face x={32} y={35} mood={mood} />
    </>
  ),
};

export function Avatar({ kind, color, mood = 'idle', size = 56 }: AvatarProps): ReactNode {
  return (
    <svg className={`avatar avatar--${mood}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {SHAPES[kind](color, mood)}
    </svg>
  );
}

export function Cherry({ lost = false, size = 22 }: { lost?: boolean; size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={lost ? 'cherry cherry--lost' : 'cherry'}>
      <path d="M12 15q-1-8 6-12" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <path d="M17.5 3q-5-1.5-6 2q4 1.5 6-2z" fill={lost ? 'none' : COLORS.pistache} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx="11" cy="16.5" r="6" fill={lost ? 'none' : COLORS.framboise} stroke={INK} strokeWidth={2} strokeDasharray={lost ? '2.5 3' : undefined} />
      {!lost && <circle cx="8.8" cy="14.2" r="1.5" fill="#fff" opacity={0.85} />}
    </svg>
  );
}
