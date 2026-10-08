import type { AvatarId, CardId } from '../../shared/rules';
import type { TimedEffect } from './game/pieces';

/** La palette : six couleurs de vitrine de pâtisserie, plus le carrelage. */
export const COLORS = {
  choco: '#3A2317',
  creme: '#FFF4DC',
  framboise: '#E0356B',
  myrtille: '#4A5BD4',
  citron: '#F5BE2E',
  pistache: '#3F9B56',
  carrelage: '#DCEBCF',
  joint: '#C6DBB6',
} as const;

export const PLAYER_COLORS = [COLORS.framboise, COLORS.myrtille, COLORS.citron, COLORS.pistache] as const;
export const PLAYER_COLOR_NAMES = ['framboise', 'myrtille', 'citron', 'pistache'] as const;

export function playerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

const mixCache = new Map<string, string>();

/** Mélange deux couleurs hexadécimales (t = part de la seconde). */
export function mix(a: string, b: string, t: number): string {
  const key = `${a}${b}${t}`;
  const cached = mixCache.get(key);
  if (cached) return cached;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number): number => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  const value = `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  mixCache.set(key, value);
  return value;
}

export const AVATAR_NAMES: Record<AvatarId, string> = {
  chou: 'Chou',
  macaron: 'Macaron',
  eclair: 'Éclair',
  tartelette: 'Tartelette',
  cannele: 'Cannelé',
  madeleine: 'Madeleine',
};

export interface CardInfo {
  name: string;
  kind: 'bonus' | 'malus';
  /** ce que fait la carte, en une ligne */
  effect: string;
  /** annonce visible par tous : a = auteur, b = cible */
  announce: (a: string, b: string) => string;
}

export const CARDS: Record<CardId, CardInfo> = {
  caramel: {
    name: 'Caramel',
    kind: 'bonus',
    effect: 'Ta prochaine part se soude à la tour.',
    announce: (a) => `${a} caramélise sa prochaine part !`,
  },
  plat: {
    name: 'Grand plat',
    kind: 'bonus',
    effect: 'Présentoir élargi pendant 10 s.',
    announce: (a) => `${a} sort le grand plat !`,
  },
  fourchette: {
    name: 'Coup de fourchette',
    kind: 'bonus',
    effect: 'Ta dernière part posée disparaît.',
    announce: (a) => `${a} mange sa dernière part !`,
  },
  neige: {
    name: 'Blancs en neige',
    kind: 'bonus',
    effect: 'Chute toute douce pendant 8 s.',
    announce: (a) => `${a} monte les blancs en neige !`,
  },
  chef: {
    name: 'Part du chef',
    kind: 'malus',
    effect: 'Sa prochaine part est énorme.',
    announce: (a, b) => `${a} sert la part du chef à ${b} !`,
  },
  beurre: {
    name: 'Motte de beurre',
    kind: 'malus',
    effect: 'Sa prochaine part glisse.',
    announce: (a, b) => `${a} beurre ${b} !`,
  },
  farine: {
    name: 'Nuage de farine',
    kind: 'malus',
    effect: "Le haut de son écran disparaît 6 s.",
    announce: (a, b) => `${a} enfarine ${b} !`,
  },
  rhum: {
    name: 'Baba au rhum',
    kind: 'malus',
    effect: 'Gauche et droite inversées 5 s.',
    announce: (a, b) => `${a} fait goûter le rhum à ${b} !`,
  },
  air: {
    name: "Courant d'air",
    kind: 'malus',
    effect: 'Une rafale pousse sa part de côté.',
    announce: (a, b) => `${a} ouvre la fenêtre chez ${b} !`,
  },
  feu: {
    name: 'Coup de feu',
    kind: 'malus',
    effect: 'Ses parts tombent très vite 8 s.',
    announce: (a, b) => `Coup de feu chez ${b}, signé ${a} !`,
  },
};

export const EFFECT_LABELS: Record<TimedEffect, string> = {
  slow: 'Blancs en neige',
  turbo: 'Coup de feu',
  invert: 'Baba au rhum',
  fog: 'Nuage de farine',
  wide: 'Grand plat',
  wind: "Courant d'air",
};

export const FONT_DISPLAY = '"Bagel Fat One", "Arial Rounded MT Bold", system-ui, sans-serif';
export const FONT_TEXT = 'Figtree, system-ui, sans-serif';
