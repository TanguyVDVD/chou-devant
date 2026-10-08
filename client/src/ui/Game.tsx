import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerView, RoomSnapshot } from '../../../shared/protocol';
import { RULES } from '../../../shared/rules';
import { play } from '../game/audio';
import type { Direction, Mood } from '../game/session';
import { findPlayer, leaveRoom, opponents, playBonus, playMalus, session, toggleMute, useApp } from '../store';
import { CARDS, COLORS, PLAYER_COLORS, playerColor } from '../theme';
import { Avatar, Cherry } from './Avatar';
import { CardArt } from './CardArt';
import { RoundOverlay } from './RoundOverlay';

function TowerCanvas({ id, label }: { id: string; label: string }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    session.setCanvas(id, ref.current);
    return () => session.setCanvas(id, null);
  }, [id]);
  return <canvas ref={ref} className="tower" role="img" aria-label={label} />;
}

function Cherries({ player, max }: { player: PlayerView; max: number }): ReactNode {
  return (
    <span className="cherries" aria-label={`${player.hearts} cerises sur ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Cherry key={i} lost={i >= player.hearts} />
      ))}
    </span>
  );
}

function Wins({ player, total }: { player: PlayerView; total: number }): ReactNode {
  return (
    <span className="wins" aria-label={`${player.wins} manches gagnées sur ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`wins__dot${i < player.wins ? ' is-won' : ''}`} style={{ '--c': playerColor(player.color) } as CSSProperties} />
      ))}
    </span>
  );
}

function Floors({ player, finish }: { player: PlayerView; finish: number }): ReactNode {
  return (
    <span className="floors">
      <strong>{Math.floor(player.height)}</strong> / {finish} étages
    </span>
  );
}

function useKeyboard(): void {
  useEffect(() => {
    const digits: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };
    const handleDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        if (!event.repeat) session.press(event.code === 'ArrowLeft' ? -1 : 1, event.shiftKey);
      } else if (event.code === 'ArrowUp') {
        event.preventDefault();
        if (!event.repeat) session.rotate();
      } else if (event.code === 'ArrowDown') {
        event.preventDefault();
        session.softDrop(true);
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) playBonus();
      } else if (event.code in digits && !event.repeat) {
        playMalus(digits[event.code]);
      }
    };
    const handleUp = (event: KeyboardEvent): void => {
      if (event.code === 'ArrowLeft') session.release(-1);
      else if (event.code === 'ArrowRight') session.release(1);
      else if (event.code === 'ArrowDown') session.softDrop(false);
    };
    const handleBlur = (): void => {
      session.release(-1);
      session.release(1);
      session.softDrop(false);
    };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);
}

function TouchControls(): ReactNode {
  const [half, setHalf] = useState(false);
  const hold = (direction: Direction) => ({
    onPointerDown: () => session.press(direction, half),
    onPointerUp: () => session.release(direction),
    onPointerLeave: () => session.release(direction),
    onPointerCancel: () => session.release(direction),
  });
  return (
    <div className="touch" aria-label="Commandes tactiles">
      <button type="button" className="touch__btn" aria-label="Gauche" {...hold(-1)}>
        ◀
      </button>
      <button type="button" className="touch__btn" aria-label="Droite" {...hold(1)}>
        ▶
      </button>
      <button type="button" className={`touch__btn touch__btn--small${half ? ' is-on' : ''}`} aria-pressed={half} onClick={() => setHalf(!half)}>
        ½ pas
      </button>
      <button type="button" className="touch__btn" aria-label="Tourner" onPointerDown={() => session.rotate()}>
        ↻
      </button>
      <button
        type="button"
        className="touch__btn"
        aria-label="Accélérer"
        onPointerDown={() => session.softDrop(true)}
        onPointerUp={() => session.softDrop(false)}
        onPointerLeave={() => session.softDrop(false)}
        onPointerCancel={() => session.softDrop(false)}
      >
        ▼
      </button>
    </div>
  );
}

function Countdown({ until }: { until: number }): ReactNode {
  const [left, setLeft] = useState(() => until - performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setLeft(until - performance.now()), 80);
    return () => clearInterval(id);
  }, [until]);

  const seconds = Math.ceil(left / 1000);
  const label = left <= 0 ? 'Envoyez !' : seconds > 3 ? 'À vos fouets' : String(seconds);
  useEffect(() => {
    if (label === 'Envoyez !') play('go');
    else if (label.length === 1) play('tick');
  }, [label]);

  if (left < -900) return null;
  return (
    <div className="countdown" aria-live="assertive">
      <span key={label} className="countdown__label">
        {label}
      </span>
    </div>
  );
}

function Hand({ me, room, rivals }: { me: PlayerView | null; room: RoomSnapshot; rivals: PlayerView[] }): ReactNode {
  const { offers } = useApp();
  const offer = offers[0];
  if (!me?.alive) return null;

  if (!offer) {
    const next = (Math.floor(me.height / RULES.TIER_HEIGHT) + 1) * RULES.TIER_HEIGHT;
    return (
      <section className="hand hand--empty" aria-label="Tes cartes">
        <p>{next < room.finish ? `Prochaine carte à l’étage ${next}.` : 'Plus de carte à gagner : fonce vers la ligne !'}</p>
      </section>
    );
  }

  const bonus = CARDS[offer.bonus];
  const malus = CARDS[offer.malus];
  const targets = rivals.filter((p) => p.alive);
  return (
    <section className="hand" aria-label="Tes cartes">
      <p className="hand__title">
        Une carte, deux recettes{offers.length > 1 && <span className="hand__more"> (+{offers.length - 1} en attente)</span>}
      </p>
      <button type="button" className="card card--bonus" onClick={playBonus}>
        <CardArt card={offer.bonus} />
        <span className="card__text">
          <span className="card__name">{bonus.name}</span>
          <span className="card__effect">{bonus.effect}</span>
        </span>
        <kbd className="card__key">Espace</kbd>
      </button>
      <div className="card card--malus">
        <CardArt card={offer.malus} />
        <span className="card__text">
          <span className="card__name">{malus.name}</span>
          <span className="card__effect">{malus.effect}</span>
        </span>
        <span className="card__targets">
          {targets.length === 0 && <span className="card__effect">Plus personne à viser.</span>}
          {targets.map((p) => (
            <button key={p.id} type="button" className="card__target" style={{ '--c': playerColor(p.color) } as CSSProperties} onClick={() => playMalus(p.id)}>
              <kbd>{rivals.indexOf(p) + 1}</kbd> {p.name}
            </button>
          ))}
        </span>
      </div>
    </section>
  );
}

function Rival({ player, rank, room, mood, canTarget }: { player: PlayerView; rank: number; room: RoomSnapshot; mood: Mood; canTarget: boolean }): ReactNode {
  const color = playerColor(player.color);
  return (
    <button
      type="button"
      className={`rival${player.alive ? '' : ' is-out'}${canTarget ? ' is-target' : ''}`}
      style={{ '--c': color } as CSSProperties}
      disabled={!canTarget}
      onClick={() => playMalus(player.id)}
      aria-label={canTarget ? `Lancer le malus sur ${player.name}` : player.name}
    >
      <span className="rival__head">
        <kbd className="rival__key">{rank}</kbd>
        <Avatar kind={player.avatar} color={color} mood={mood} size={40} />
        <span className="rival__name">{player.name}</span>
        <Wins player={player} total={room.winsToWin} />
      </span>
      <span className="rival__view">
        <TowerCanvas id={player.id} label={`Tour de ${player.name}`} />
        {!player.alive && <span className="rival__out">{player.connected ? (player.inRound ? 'Éliminé' : 'En attente') : 'Déconnecté'}</span>}
      </span>
      <span className="rival__foot">
        <Cherries player={player} max={room.maxHearts} />
        <Floors player={player} finish={room.finish} />
      </span>
    </button>
  );
}

function Announcements(): ReactNode {
  const { announcements } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {announcements.map((a) => (
        <p key={a.id} className={`toast toast--${a.kind}`} style={{ '--c': a.color === null ? COLORS.choco : PLAYER_COLORS[a.color] } as CSSProperties}>
          {a.card && <CardArt card={a.card} size={30} />}
          <span>{a.text}</span>
        </p>
      ))}
    </div>
  );
}

export function Game({ room }: { room: RoomSnapshot }): ReactNode {
  const { you, offers, moods, countdownUntil, muted } = useApp();
  const me = findPlayer(room, you);
  const rivals = opponents(room, you);
  const myColor = playerColor(me?.color ?? 0);
  const inRound = room.phase === 'countdown' || room.phase === 'playing';
  const canAct = room.phase === 'playing' && Boolean(me?.alive) && offers.length > 0;

  useKeyboard();
  useEffect(() => {
    session.attach();
    return () => session.detach();
  }, []);

  let notice: string | null = null;
  if (me && !me.alive && inRound) {
    notice = me.hearts === 0 ? 'Plus de cerises ! Tu regardes la fin de la manche.' : 'Tu es hors-jeu pour cette manche. Tu reprends à la prochaine.';
  }

  return (
    <main className="game" style={{ '--me': myColor } as CSSProperties}>
      <header className="game__bar">
        <span className="logo logo--tiny">Chou Devant&nbsp;!</span>
        <span className="game__round">
          Manche {room.round} <span className="game__goal">(première pâtisserie à {room.winsToWin})</span>
        </span>
        <button type="button" className="btn btn--quiet" aria-pressed={muted} onClick={toggleMute}>
          {muted ? 'Remettre le son' : 'Couper le son'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={leaveRoom}>
          Quitter
        </button>
      </header>

      <div className="game__arena">
        <aside className="game__side">
          {me && (
            <button type="button" className="mine" disabled={!canAct} onClick={playBonus} aria-label={canAct ? 'Utiliser mon bonus' : me.name}>
              <Avatar kind={me.avatar} color={myColor} mood={moods[me.id] ?? 'idle'} size={68} />
              <span className="mine__name">{me.name}</span>
              <Wins player={me} total={room.winsToWin} />
              <Cherries player={me} max={room.maxHearts} />
              <Floors player={me} finish={room.finish} />
            </button>
          )}
          <Hand me={me} room={room} rivals={rivals} />
        </aside>

        <section className="game__main" aria-label="Ta tour">
          {you && <TowerCanvas id={you} label="Ta tour" />}
          {notice && <p className="game__notice">{notice}</p>}
          {countdownUntil !== null && <Countdown until={countdownUntil} />}
          <Announcements />
        </section>

        <aside className="game__rivals" aria-label="Adversaires">
          {rivals.map((player, i) => (
            <Rival key={player.id} player={player} rank={i + 1} room={room} mood={moods[player.id] ?? 'idle'} canTarget={canAct && player.alive} />
          ))}
        </aside>
      </div>

      <TouchControls />
      <RoundOverlay room={room} />
    </main>
  );
}
