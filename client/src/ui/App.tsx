import type { ReactNode } from 'react';
import { useApp } from '../store';
import { Game } from './Game';
import { Home } from './Home';
import { Lobby } from './Lobby';

export function App(): ReactNode {
  const { room, connected } = useApp();

  let screen: ReactNode;
  if (!room) screen = <Home />;
  else if (room.phase === 'lobby') screen = <Lobby room={room} />;
  else screen = <Game room={room} />;

  return (
    <>
      {screen}
      {room && !connected && (
        <p className="offline" role="status">
          Connexion perdue. On retente tout seul…
        </p>
      )}
    </>
  );
}
