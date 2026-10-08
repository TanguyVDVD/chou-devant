import type { CSSProperties, ReactNode } from 'react';
import type { PlayerView, RoomSnapshot } from '../../../shared/protocol';
import { RULES } from '../../../shared/rules';
import { backToLobby, findPlayer, leaveRoom, useApp } from '../store';
import { PLAYER_COLORS, playerColor } from '../theme';
import { Avatar } from './Avatar';

const SPRINKLES = Array.from({ length: 42 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 30) / 10,
  duration: 2.6 + ((i * 17) % 20) / 10,
  turn: (i * 71) % 360,
  color: PLAYER_COLORS[i % PLAYER_COLORS.length],
}));

/** Pluie de vermicelles en sucre pour la victoire finale. */
function Sprinkles(): ReactNode {
  return (
    <div className="sprinkles" aria-hidden="true">
      {SPRINKLES.map((s, i) => (
        <span
          key={i}
          style={{ left: `${s.left}%`, background: s.color, animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s`, '--turn': `${s.turn}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function Scoreboard({ room, winner }: { room: RoomSnapshot; winner: string | null }): ReactNode {
  const ranked = [...room.players].sort((a, b) => b.wins - a.wins);
  return (
    <ol className="scores">
      {ranked.map((p: PlayerView) => (
        <li key={p.id} className={`scores__row${p.id === winner ? ' is-winner' : ''}`} style={{ '--c': playerColor(p.color) } as CSSProperties}>
          <Avatar kind={p.avatar} color={playerColor(p.color)} mood={p.id === winner ? 'happy' : 'idle'} size={44} />
          <span className="scores__name">{p.name}</span>
          <span className="scores__bells" aria-label={`${p.wins} manches gagnées`}>
            {Array.from({ length: room.winsToWin }, (_, i) => (
              <span key={i} className={`scores__bell${i < p.wins ? ' is-won' : ''}`} />
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RoundOverlay({ room }: { room: RoomSnapshot }): ReactNode {
  const { you } = useApp();
  const result = room.lastResult;
  if (!result || (room.phase !== 'scores' && room.phase !== 'final')) return null;

  const winner = findPlayer(room, result.winner);
  const isHost = room.hostId === you;

  if (room.phase === 'scores') {
    let headline = 'Personne ne remporte la manche';
    if (winner) {
      headline = result.reason === 'finish' ? `Manche ${result.round} pour ${winner.name} !` : `${winner.name} est le dernier debout !`;
    }
    return (
      <div className="overlay" role="dialog" aria-label="Fin de manche">
        <div className="overlay__box">
          <h2 className="overlay__title">{headline}</h2>
          <Scoreboard room={room} winner={result.winner} />
          <p className="overlay__next">La manche suivante arrive.</p>
          <div className="overlay__timer" style={{ animationDuration: `${RULES.SCORES_MS}ms` }} />
        </div>
      </div>
    );
  }

  const champion = result.abandoned ? null : winner;
  return (
    <div className="overlay overlay--final" role="dialog" aria-label="Fin de partie">
      {champion && <Sprinkles />}
      <div className="overlay__box">
        {champion ? (
          <>
            <div className="overlay__champion">
              <Avatar kind={champion.avatar} color={playerColor(champion.color)} mood="happy" size={132} />
            </div>
            <h2 className="overlay__title overlay__title--big">{champion.id === you ? 'Tu régales !' : `${champion.name} régale !`}</h2>
            <p className="overlay__next">La plus belle pièce montée du service.</p>
          </>
        ) : (
          <>
            <h2 className="overlay__title">Service interrompu</h2>
            <p className="overlay__next">Il ne reste plus assez de pâtissiers pour continuer.</p>
          </>
        )}
        <Scoreboard room={room} winner={champion?.id ?? null} />
        {isHost ? (
          <button type="button" className="btn btn--primary btn--big" onClick={backToLobby}>
            Retourner au salon
          </button>
        ) : (
          <p className="hint">L’hôte peut relancer une partie depuis le salon.</p>
        )}
        <button type="button" className="btn btn--quiet" onClick={leaveRoom}>
          Quitter le salon
        </button>
      </div>
    </div>
  );
}
