import { useState, type ReactNode } from 'react';
import type { RoomSnapshot } from '../../../shared/protocol';
import { RULES } from '../../../shared/rules';
import { leaveRoom, setReady, startGame, useApp } from '../store';
import { PLAYER_COLOR_NAMES, playerColor } from '../theme';
import { Avatar } from './Avatar';

function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?salon=${code}`;
}

function InviteBox({ code }: { code: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(code);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Presse-papiers refusé (page non sécurisée) : le lien reste sélectionnable à la main.
      setCopied(false);
    }
  };

  return (
    <div className="invite">
      <p className="invite__label">Code du salon</p>
      <p className="invite__code" aria-label={`Code ${code.split('').join(' ')}`}>
        {code.split('').map((letter, i) => (
          <span key={i} className="invite__tile">
            {letter}
          </span>
        ))}
      </p>
      <input className="input invite__link" readOnly value={link} aria-label="Lien d'invitation" onFocus={(e) => e.target.select()} />
      <button type="button" className="btn" onClick={() => void handleCopy()}>
        {copied ? 'Lien copié' : "Copier le lien d'invitation"}
      </button>
    </div>
  );
}

function Seats({ room, you }: { room: RoomSnapshot; you: string | null }): ReactNode {
  const empty = Array.from({ length: RULES.MAX_PLAYERS - room.players.length });
  return (
    <ul className="seats">
      {room.players.map((p) => {
        const isHost = p.id === room.hostId;
        let status = 'Pas encore prêt';
        if (!p.connected) status = 'Déconnecté…';
        else if (isHost) status = 'Hôte';
        else if (p.ready) status = 'Prêt';
        return (
          <li key={p.id} className={`seat${p.ready || isHost ? ' is-ready' : ''}${p.connected ? '' : ' is-away'}`}>
            <span className="seat__swatch" style={{ background: playerColor(p.color) }} title={PLAYER_COLOR_NAMES[p.color]} />
            <Avatar kind={p.avatar} color={playerColor(p.color)} mood={p.ready || isHost ? 'happy' : 'idle'} size={52} />
            <span className="seat__name">
              {p.name}
              {p.id === you && <span className="seat__you"> (toi)</span>}
            </span>
            <span className="seat__status">{status}</span>
          </li>
        );
      })}
      {empty.map((_, i) => (
        <li key={`vide-${i}`} className="seat seat--empty">
          Place libre
        </li>
      ))}
    </ul>
  );
}

export function Lobby({ room }: { room: RoomSnapshot }): ReactNode {
  const { you, error } = useApp();
  const me = room.players.find((p) => p.id === you);
  const isHost = room.hostId === you;

  return (
    <main className="lobby">
      <header className="lobby__head">
        <h1 className="logo logo--small">Chou Devant&nbsp;!</h1>
        <button type="button" className="btn btn--quiet" onClick={leaveRoom}>
          Quitter le salon
        </button>
      </header>

      <div className="lobby__body">
        <section className="panel" aria-label="Inviter des amis">
          <InviteBox code={room.code} />
        </section>

        <section className="panel lobby__players" aria-label="Joueurs">
          <h2 className="title">
            En cuisine ({room.players.length}/{RULES.MAX_PLAYERS})
          </h2>
          <Seats room={room} you={you} />

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          {isHost ? (
            <>
              <button type="button" className="btn btn--primary btn--big" disabled={room.canStart !== null} onClick={startGame}>
                Lancer la partie
              </button>
              <p className="hint">{room.canStart ?? 'Tout le monde est prêt. À toi de lancer !'}</p>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`btn btn--big${me?.ready ? '' : ' btn--primary'}`}
                aria-pressed={Boolean(me?.ready)}
                onClick={() => setReady(!me?.ready)}
              >
                {me?.ready ? 'Finalement, pas prêt' : 'Je suis prêt'}
              </button>
              <p className="hint">{me?.ready ? "L'hôte lance la partie quand tout le monde est prêt." : 'Dis que tu es prêt pour que la partie puisse démarrer.'}</p>
            </>
          )}
        </section>

        <section className="panel rules" aria-label="Règles">
          <h2 className="title">La recette</h2>
          <ul className="rules__list">
            <li>
              Empile tes parts jusqu’à la <strong>ligne de service</strong> et tiens {RULES.HOLD_MS / 1000} secondes : la manche est à toi.
            </li>
            <li>
              Chaque part tombée dans le vide coûte une cerise. Tu en as {RULES.HEARTS}.
            </li>
            <li>
              Tous les {RULES.TIER_HEIGHT} étages, tu gagnes une carte : un bonus pour toi, ou un malus pour un adversaire.
            </li>
            <li>Première pâtisserie à {RULES.WINS_TO_WIN} manches gagne la partie.</li>
          </ul>
          <dl className="keys">
            <div>
              <dt>
                <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>déplacer</dd>
            </div>
            <div>
              <dt>
                <kbd>Maj</kbd> + <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>demi-pas</dd>
            </div>
            <div>
              <dt>
                <kbd>↑</kbd>
              </dt>
              <dd>tourner</dd>
            </div>
            <div>
              <dt>
                <kbd>↓</kbd>
              </dt>
              <dd>accélérer</dd>
            </div>
            <div>
              <dt>
                <kbd>Espace</kbd>
              </dt>
              <dd>bonus</dd>
            </div>
            <div>
              <dt>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
              </dt>
              <dd>malus</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}
