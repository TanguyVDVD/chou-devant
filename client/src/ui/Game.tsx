import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerView, RoomSnapshot } from '../../../shared/protocol';
import { RULES } from '../../../shared/rules';
import { play } from '../game/audio';
import type { Direction, Mood, Status } from '../game/session';
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

/** Classement de la manche : 1 = la plus haute tour. Rien tant que personne n'a posé un étage, ni pour les éliminés. */
function ranking(players: PlayerView[]): Map<string, number> {
  const racing = players.filter((p) => p.alive);
  if (racing.every((p) => p.height < 1)) return new Map();
  return new Map(racing.map((p) => [p.id, 1 + racing.filter((o) => Math.floor(o.height) > Math.floor(p.height)).length]));
}

function Place({ place }: { place: number | undefined }): ReactNode {
  if (!place) return null;
  return <span className={`place${place === 1 ? ' is-first' : ''}`}>{place === 1 ? '1er' : `${place}e`}</span>;
}

function Floors({ player, finish, short = false }: { player: PlayerView; finish: number; short?: boolean }): ReactNode {
  return (
    <span className="floors" title={`${Math.floor(player.height)} étages sur ${finish}`}>
      <strong>{Math.floor(player.height)}</strong>
      <span className="floors__goal">
        {' '}
        / {finish}
        {!short && ' étages'}
      </span>
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

function Help({ finish }: { finish: number }): ReactNode {
  return (
    <section className="help" aria-label="Comment jouer">
      <p>
        <strong>Le but :</strong> monte ta tour jusqu’à la ligne de service ({finish} étages) et tiens-y 3 secondes. Une part qui tombe du présentoir te coûte
        une cerise.
      </p>
      <dl className="keys">
        <div>
          <dt>
            <kbd>←</kbd> <kbd>→</kbd>
          </dt>
          <dd>déplacer</dd>
        </div>
        <div>
          <dt>
            <kbd>↑</kbd>
          </dt>
          <dd>tourner</dd>
        </div>
        <div>
          <dt>
            <kbd>Maj</kbd> + <kbd>←</kbd> <kbd>→</kbd>
          </dt>
          <dd>demi-case</dd>
        </div>
        <div>
          <dt>
            <kbd>↓</kbd>
          </dt>
          <dd>accélérer</dd>
        </div>
      </dl>
    </section>
  );
}

function Hand({ me, room, rivals, places }: { me: PlayerView | null; room: RoomSnapshot; rivals: PlayerView[]; places: Map<string, number> }): ReactNode {
  const { offers } = useApp();
  const offer = offers[0];
  if (!me?.alive) return null;

  if (!offer) {
    const next = (Math.floor(me.height / RULES.TIER_HEIGHT) + 1) * RULES.TIER_HEIGHT;
    return (
      <>
        <section className="hand hand--empty" aria-label="Tes cartes">
          <p>{next < room.finish ? `Prochaine carte à l’étage ${next}.` : 'Plus de carte à gagner : fonce vers la ligne !'}</p>
        </section>
        <Help finish={room.finish} />
      </>
    );
  }

  const bonus = CARDS[offer.bonus];
  const malus = CARDS[offer.malus];
  const targets = rivals.filter((p) => p.alive);
  return (
    <section className="hand" aria-label="Tes cartes">
      <p className="hand__title">
        Choisis une des deux recettes{offers.length > 1 && <span className="hand__more"> (+{offers.length - 1} carte en attente)</span>}
      </p>
      <button type="button" className="card card--bonus" onClick={playBonus}>
        <span className="card__kind">Bonus pour toi</span>
        <CardArt card={offer.bonus} />
        <span className="card__text">
          <span className="card__name">{bonus.name}</span>
          <span className="card__effect">{bonus.effect}</span>
        </span>
        <kbd className="card__key">Espace</kbd>
      </button>
      <p className="hand__or" aria-hidden="true">
        ou
      </p>
      <div className="card card--malus">
        <span className="card__kind">Malus pour un rival</span>
        <CardArt card={offer.malus} />
        <span className="card__text">
          <span className="card__name">{malus.name}</span>
          <span className="card__effect">{malus.effect}</span>
        </span>
        <span className="card__hint">Touche la vignette d’un rival pour le lui lancer.</span>
        <span className="card__targets">
          {targets.length === 0 && <span className="card__effect">Plus personne à viser.</span>}
          {targets.map((p) => (
            <button key={p.id} type="button" className="card__target" style={{ '--c': playerColor(p.color) } as CSSProperties} onClick={() => playMalus(p.id)}>
              <kbd>{rivals.indexOf(p) + 1}</kbd>
              <span className="card__target-name">{p.name}</span>
              <span className="card__target-floors">
                {Math.floor(p.height)} ét.{places.get(p.id) === 1 && ' · en tête'}
              </span>
            </button>
          ))}
        </span>
      </div>
    </section>
  );
}

interface RivalProps {
  player: PlayerView;
  /** touche 1, 2 ou 3 qui vise ce joueur */
  slot: number;
  place: number | undefined;
  room: RoomSnapshot;
  mood: Mood;
  statuses: Status[];
  /** nom du malus en main, s'il peut être lancé sur ce joueur */
  aim: string | null;
}

function Rival({ player, slot, place, room, mood, statuses, aim }: RivalProps): ReactNode {
  const color = playerColor(player.color);
  const holding = player.alive && mood === 'happy';
  return (
    <button
      type="button"
      className={`rival${player.alive ? '' : ' is-out'}${aim ? ' is-target' : ''}${holding ? ' is-holding' : ''}`}
      style={{ '--c': color } as CSSProperties}
      disabled={!aim}
      onClick={() => playMalus(player.id)}
      aria-label={aim ? `Lancer ${aim} sur ${player.name}` : player.name}
    >
      <span className="rival__head">
        <Avatar kind={player.avatar} color={color} mood={mood} size={40} />
        <span className="rival__name">{player.name}</span>
        <Wins player={player} total={room.winsToWin} />
      </span>
      <span className="rival__score">
        <Floors player={player} finish={room.finish} short />
        <Place place={place} />
      </span>
      <span className="rival__view">
        <TowerCanvas id={player.id} label={`Tour de ${player.name}`} />
        <Cherries player={player} max={room.maxHearts} />
        {holding && <span className="rival__alert">Sur la ligne !</span>}
        {!player.alive && <span className="rival__out">{player.connected ? (player.inRound ? 'Éliminé' : 'En attente') : 'Déconnecté'}</span>}
      </span>
      <span className="rival__status">
        {statuses.map((status) => (
          <span key={status.label} className={`chip${status.bad ? ' chip--bad' : ''}`}>
            {status.label}
          </span>
        ))}
      </span>
      <span className={`rival__aim${aim ? '' : ' is-idle'}`}>
        <kbd className="rival__key">{slot}</kbd>
        <span>{aim ? `Lancer ${aim}` : 'pour lui lancer un malus'}</span>
      </span>
    </button>
  );
}

function Announcements(): ReactNode {
  const { announcements } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {announcements.map((a) => (
        <p
          key={a.id}
          className={`toast toast--${a.kind}${a.mine ? ' toast--mine' : ''}`}
          style={{ '--c': a.color === null ? COLORS.choco : PLAYER_COLORS[a.color] } as CSSProperties}
        >
          {a.card && <CardArt card={a.card} size={a.mine ? 38 : 30} />}
          <span className="toast__text">
            <span>{a.text}</span>
            {a.detail && <span className="toast__detail">{a.detail}</span>}
          </span>
        </p>
      ))}
    </div>
  );
}

export function Game({ room }: { room: RoomSnapshot }): ReactNode {
  const { you, offers, moods, statuses, countdownUntil, muted } = useApp();
  const me = findPlayer(room, you);
  const rivals = opponents(room, you);
  const myColor = playerColor(me?.color ?? 0);
  const inRound = room.phase === 'countdown' || room.phase === 'playing';
  const canAct = room.phase === 'playing' && Boolean(me?.alive) && offers.length > 0;
  const places = ranking(room.players);
  const malusName = canAct ? CARDS[offers[0].malus].name : null;

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
          Manche {room.round} <span className="game__goal">· {room.winsToWin} manches pour gagner la partie</span>
        </span>
        <button type="button" className="btn btn--quiet" aria-pressed={muted} onClick={toggleMute}>
          {muted ? 'Remettre le son' : 'Couper le son'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={leaveRoom}>
          Quitter
        </button>
      </header>

      <div className="game__arena" style={{ '--rivals': rivals.length } as CSSProperties}>
        <aside className="game__side">
          {me && (
            <button type="button" className="mine" disabled={!canAct} onClick={playBonus} aria-label={canAct ? 'Utiliser mon bonus' : me.name}>
              <Avatar kind={me.avatar} color={myColor} mood={moods[me.id] ?? 'idle'} size={68} />
              <span className="mine__name">{me.name}</span>
              <Wins player={me} total={room.winsToWin} />
              <Cherries player={me} max={room.maxHearts} />
              <span className="mine__score">
                <Floors player={me} finish={room.finish} />
                <Place place={places.get(me.id)} />
              </span>
            </button>
          )}
          <Hand me={me} room={room} rivals={rivals} places={places} />
        </aside>

        <section className="game__main" aria-label="Ta tour">
          {you && <TowerCanvas id={you} label="Ta tour" />}
          {notice && <p className="game__notice">{notice}</p>}
          {countdownUntil !== null && <Countdown until={countdownUntil} />}
        </section>

        <aside className="game__rivals" aria-label="Adversaires">
          {rivals.map((player, i) => (
            <Rival
              key={player.id}
              player={player}
              slot={i + 1}
              place={places.get(player.id)}
              room={room}
              mood={moods[player.id] ?? 'idle'}
              statuses={statuses[player.id] ?? []}
              aim={player.alive ? malusName : null}
            />
          ))}
        </aside>

        <Announcements />
      </div>

      <TouchControls />
      <RoundOverlay room={room} />
    </main>
  );
}
