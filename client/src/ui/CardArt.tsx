import type { ReactNode } from 'react';
import type { CardId } from '../../../shared/rules';
import { COLORS, mix } from '../theme';

const INK = COLORS.choco;
const CARAMEL = mix(COLORS.citron, COLORS.choco, 0.32);
const LINE = { stroke: INK, strokeWidth: 2.4, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;

// Une petite illustration par carte, dessinée à la main en SVG.
const ART: Record<CardId, ReactNode> = {
  caramel: (
    <>
      <path d="M8 12h32v8q0 5-4 5v9q0 4-4 4t-4-4v-5q0-3-3-3t-3 3v11q0 4-4 4t-4-4v-20q-6 0-6-5z" fill={CARAMEL} {...LINE} />
      <path d="M13 17h14" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />
    </>
  ),
  froid: (
    <>
      <circle cx="24" cy="24" r="19" fill={mix(COLORS.myrtille, '#ffffff', 0.72)} {...LINE} />
      <path d="M24 9v30M11 16.5l26 15M37 16.5l-26 15" fill="none" {...LINE} />
      <path d="M20 12l4 4l4-4M20 36l4-4l4 4" fill="none" {...LINE} strokeWidth={1.8} />
    </>
  ),
  fourchette: (
    <>
      <path d="M17 5v11q0 6 7 6t7-6v-11m-7 0v12" fill="none" {...LINE} strokeWidth={3} />
      <path d="M24 22v21" fill="none" {...LINE} strokeWidth={4.5} />
    </>
  ),
  neige: (
    <>
      <path d="M6 40q-2-9 7-10q-1-9 8-9q2-10 11-3q9-1 8 9q8 3 2 13z" fill="#fff" {...LINE} />
      <path d="M24 8q5 5 0 9" fill="none" {...LINE} />
      <path d="M16 31q4-3 7 0m4-4q4-3 7 0" fill="none" {...LINE} strokeWidth={1.8} opacity={0.5} />
    </>
  ),
  chef: (
    <>
      <path d="M12 28q-9-3-5-12q4-7 11-3q6-9 12 0q8-4 11 3q3 9-5 12z" fill="#fff" {...LINE} />
      <rect x="12" y="28" width="24" height="13" rx="3" fill="#fff" {...LINE} />
      <path d="M18 32v5m6-5v5m6-5v5" fill="none" {...LINE} strokeWidth={1.8} opacity={0.5} />
    </>
  ),
  beurre: (
    <>
      <path d="M5 22l12-8h26l-10 8z" fill={mix(COLORS.citron, COLORS.creme, 0.55)} {...LINE} />
      <path d="M5 22h28v14h-28z" fill={COLORS.citron} {...LINE} />
      <path d="M33 22l10-8v13l-10 9z" fill={mix(COLORS.citron, COLORS.choco, 0.18)} {...LINE} />
      <path d="M10 27h9" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" opacity={0.8} />
    </>
  ),
  farine: (
    <>
      <path d="M13 15h22l4 27h-30z" fill={COLORS.creme} {...LINE} />
      <path d="M13 15q-3-7 4-6q7-6 14 0q7-1 4 6z" fill="#fff" {...LINE} />
      <circle cx="24" cy="29" r="6" fill="none" {...LINE} strokeWidth={1.8} opacity={0.55} />
      <circle cx="41" cy="9" r="1.6" fill={INK} />
      <circle cx="6" cy="12" r="1.3" fill={INK} />
    </>
  ),
  rhum: (
    <>
      <path d="M19 5h10v9q7 4 7 12v17h-24v-17q0-8 7-12z" fill={CARAMEL} {...LINE} />
      <rect x="15" y="26" width="18" height="10" fill={COLORS.creme} {...LINE} strokeWidth={1.8} />
      <path d="M40 9l3-3m-1 9h4m-41-6l-3-3m1 9h-3" fill="none" {...LINE} strokeWidth={1.8} />
    </>
  ),
  air: (
    <path d="M4 17h24q7 0 7-6q0-5-5-5t-5 4m-21 14h34q6 0 6 6t-6 6q-4 0-4-4m-30 2h17" fill="none" {...LINE} strokeWidth={3.2} />
  ),
  feu: (
    <>
      <path d="M24 4q14 12 12 25q-1 14-12 14t-12-14q-1-7 5-12q0 6 3 7q-2-10 4-20z" fill={COLORS.framboise} {...LINE} />
      <path d="M24 24q6 6 5 11q-1 6-5 6t-5-6q-1-5 5-11z" fill={COLORS.citron} {...LINE} strokeWidth={1.8} />
    </>
  ),
};

export function CardArt({ card, size = 44 }: { card: CardId; size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {ART[card]}
    </svg>
  );
}
