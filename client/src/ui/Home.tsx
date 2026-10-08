import { useState, type FormEvent, type ReactNode } from 'react';
import { AVATARS, RULES } from '../../../shared/rules';
import { clearError, createRoom, joinRoom, setProfile, useApp } from '../store';
import { AVATAR_NAMES, COLORS, PLAYER_COLORS } from '../theme';
import { Avatar } from './Avatar';

/** La pile de parts qui tangue : l'image du jeu avant même d'y jouer. */
function WobblyStack(): ReactNode {
  const blocks = [
    { x: 46, y: 168, w: 108, color: PLAYER_COLORS[0] },
    { x: 64, y: 128, w: 72, color: PLAYER_COLORS[2] },
    { x: 40, y: 88, w: 96, color: PLAYER_COLORS[1] },
    { x: 78, y: 48, w: 60, color: PLAYER_COLORS[3] },
  ];
  return (
    <svg className="stack" viewBox="0 0 200 270" aria-hidden="true">
      <g className="stack__tower">
        {blocks.map((block, i) => (
          <g key={block.y} className="stack__block" style={{ animationDelay: `${i * 0.12}s` }}>
            <rect x={block.x} y={block.y} width={block.w} height="40" rx="7" fill={block.color} stroke={COLORS.choco} strokeWidth="3.5" />
            <rect x={block.x + 9} y={block.y + 8} width={block.w - 18} height="24" rx="6" fill="#fff" opacity="0.32" />
            {[-9, 9].map((dx) => (
              <g key={dx}>
                <circle cx={block.x + block.w / 2 + dx} cy={block.y + 17} r="5.5" fill="#fff" stroke={COLORS.choco} strokeWidth="1.8" />
                <circle cx={block.x + block.w / 2 + dx + (i % 2 ? 1.5 : -1.5)} cy={block.y + 18} r="2.4" fill={COLORS.choco} />
              </g>
            ))}
            <path
              d={`M${block.x + block.w / 2 - 5} ${block.y + 28}q5 ${i === 3 ? -5 : 5} 10 0`}
              fill="none"
              stroke={COLORS.choco}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
      <rect x="30" y="208" width="140" height="13" rx="5" fill={COLORS.creme} stroke={COLORS.choco} strokeWidth="3.5" />
      <path d="M90 221h20l12 40h-44z" fill={COLORS.creme} stroke={COLORS.choco} strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Home(): ReactNode {
  const { name, avatar, invite, busy, error, connected } = useApp();
  const [code, setCode] = useState(invite ?? '');
  const ready = name.trim().length > 0 && connected && !busy;

  const handleJoin = (event: FormEvent): void => {
    event.preventDefault();
    if (ready && code.length === 4) joinRoom(code);
  };

  return (
    <main className="home">
      <section className="home__intro">
        <h1 className="logo">
          Chou
          <br />
          Devant&nbsp;!
        </h1>
        <p className="home__pitch">
          Montez votre pièce montée plus haut que celle des copains, sans rien faire tomber du présentoir. De{' '}
          {RULES.MIN_PLAYERS} à {RULES.MAX_PLAYERS} pâtissiers.
        </p>
        <WobblyStack />
      </section>

      <section className="panel home__form" aria-label="Entrer en cuisine">
        <label className="field">
          <span className="field__label">Ton pseudo</span>
          <input
            className="input"
            value={name}
            maxLength={RULES.NAME_MAX}
            placeholder="Léa, Tom, Mamie…"
            autoComplete="nickname"
            onChange={(e) => {
              clearError();
              setProfile(e.target.value, avatar);
            }}
          />
        </label>

        <fieldset className="field avatars">
          <legend className="field__label">Ta pâtisserie</legend>
          <div className="avatars__grid">
            {AVATARS.map((kind) => (
              <label key={kind} className={`avatars__choice${kind === avatar ? ' is-picked' : ''}`}>
                <input
                  type="radio"
                  name="avatar"
                  className="visually-hidden"
                  checked={kind === avatar}
                  onChange={() => setProfile(name, kind)}
                />
                <Avatar kind={kind} color={COLORS.framboise} mood={kind === avatar ? 'happy' : 'idle'} size={54} />
                <span>{AVATAR_NAMES[kind]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {!connected && <p className="hint">Connexion au serveur…</p>}

        {invite ? (
          <>
            <button type="button" className="btn btn--primary btn--big" disabled={!ready} onClick={() => joinRoom(invite)}>
              Rejoindre le salon {invite}
            </button>
            <button type="button" className="btn" disabled={!ready} onClick={createRoom}>
              Créer plutôt mon salon
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--big" disabled={!ready} onClick={createRoom}>
              Créer un salon
            </button>
            <form className="join" onSubmit={handleJoin}>
              <label className="field join__field">
                <span className="field__label">Ou rejoins avec un code</span>
                <input
                  className="input input--code"
                  value={code}
                  maxLength={4}
                  placeholder="ABCD"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    clearError();
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''));
                  }}
                />
              </label>
              <button type="submit" className="btn" disabled={!ready || code.length !== 4}>
                Rejoindre
              </button>
            </form>
          </>
        )}
        {name.trim().length === 0 && <p className="hint">Choisis un pseudo pour entrer en cuisine.</p>}
      </section>
    </main>
  );
}
