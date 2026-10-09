// Règles du jeu, partagées par le serveur et le client. Les hauteurs sont en
// « étages » (une case de part de gâteau = un étage).
export const RULES = {
  MAX_PLAYERS: 4,
  MIN_PLAYERS: 2,
  HEARTS: 3,
  WINS_TO_WIN: 3,
  FINISH_HEIGHT: 20,
  TIER_HEIGHT: 5,
  MAX_OFFERS: 2,
  HOLD_MS: 3000,
  COUNTDOWN_MS: 4000,
  SCORES_MS: 7000,
  STATE_TIMEOUT_MS: 1500,
  LOBBY_GRACE_MS: 30000,
  EMPTY_ROOM_MS: 60000,
  MAX_HEIGHT: 60,
  MAX_BODIES: 70,
  NAME_MAX: 14,
} as const;

export const BONUS = ['caramel', 'froid', 'fourchette', 'neige'] as const;
export const MALUS = ['chef', 'beurre', 'farine', 'rhum', 'air', 'feu'] as const;
export const AVATARS = ['chou', 'macaron', 'eclair', 'tartelette', 'cannele', 'madeleine'] as const;

export type BonusId = (typeof BONUS)[number];
export type MalusId = (typeof MALUS)[number];
export type CardId = BonusId | MalusId;
export type AvatarId = (typeof AVATARS)[number];
