# Chou Devant !

Jeu web multijoueur en temps réel (2 à 4 joueurs) d'empilement avec physique,
inspiré du principe de Tricky Towers mais avec un nom, un univers, des visuels
et des sons 100 % originaux. Hébergé par un particulier sur son PC dans Docker ;
les amis rejoignent par un tunnel Cloudflare. Toute l'interface est en français.

## Le jeu

- **Univers** : une brigade de pâtissiers. Chaque joueur monte une pièce montée
  sur un présentoir à gâteau trop étroit. Le nom détourne « chaud devant ! ».
- **Parts** : 7 formes de tétrominos, des parts de gâteau avec des yeux. On les
  déplace et on les tourne pendant leur chute ; une fois posées, elles obéissent
  à la physique (elles basculent, glissent, tombent).
- **Manche (mode Course)** : le premier dont la tour atteint la ligne de service
  (18 étages) et y tient 3 secondes gagne la manche. Dernier survivant = gagnant.
- **Cerises** : 3 vies. Chaque part tombée dans le vide en coûte une ; à zéro,
  le joueur est éliminé de la manche.
- **Partie** : 3 manches gagnantes, tableau des scores entre les manches.
- **Cartes** : tous les 3 étages, le joueur reçoit une offre « un bonus pour moi
  OU un malus pour un adversaire » (2 offres en main au maximum).

| Identifiant  | Nom affiché        | Type  | Effet                                        |
|--------------|--------------------|-------|----------------------------------------------|
| `caramel`    | Caramel            | bonus | la prochaine part se soude à la tour         |
| `plat`       | Grand plat         | bonus | présentoir élargi (5 → 8 cases) pendant 10 s |
| `fourchette` | Coup de fourchette | bonus | supprime la dernière part posée              |
| `neige`      | Blancs en neige    | bonus | chute lente 8 s                              |
| `chef`       | Part du chef       | malus | prochaine part géante (×1,5)                 |
| `beurre`     | Motte de beurre    | malus | prochaine part glissante                     |
| `farine`     | Nuage de farine    | malus | haut de l'écran masqué 6 s                   |
| `rhum`       | Baba au rhum       | malus | gauche/droite inversées 5 s                  |
| `air`        | Courant d'air      | malus | rafale latérale 1,2 s                        |
| `feu`        | Coup de feu        | malus | chute très rapide 8 s                        |

Règle d'équilibrage : effets courts, jamais éliminatoires à eux seuls.

- **Commandes** : `←` `→` déplacer d'une case, `Maj` + `←` `→` demi-case, `↑`
  tourner, `↓` accélérer, `Espace` bonus, `1` `2` `3` malus sur l'adversaire visé
  (ou clic sur sa vignette). Boutons tactiles sur écran tactile.
- **Déconnexion** : le joueur est éliminé de la manche, la partie continue ; il
  retrouve sa place en rechargeant (jeton en `sessionStorage`) et rejoue à la
  manche suivante.

## Direction artistique (à respecter)

- Palette de 6 couleurs, définie dans `client/src/theme.ts` et en variables CSS
  dans `client/src/styles.css` : chocolat `#3A2317` (traits et texte), crème
  `#FFF4DC` (surfaces), framboise `#E0356B`, myrtille `#4A5BD4`, citron
  `#F5BE2E`, pistache `#3F9B56`. Les quatre dernières sont les couleurs des
  joueurs. Fond : carrelage pistache pâle `#DCEBCF`.
- Typographie : Bagel Fat One (titres, annonces, chiffres) et Figtree (texte),
  embarquées via `@fontsource` (sous-ensemble latin uniquement).
- Tout est dessiné en SVG ou canvas : aucune image externe, aucun fichier son
  (Web Audio API dans `client/src/game/audio.ts`).
- Interdits : style néon sur fond sombre, dégradé violet, ressemblance visuelle
  avec Tetris ou Tricky Towers.
- Lisibilité obligatoire : la part active (fond crème, halo blanc), les bords du
  présentoir (triangles + pointillés) et la ligne d'arrivée doivent toujours se
  distinguer d'un coup d'œil.
- Les animations respectent `prefers-reduced-motion`.
- Vignettes des adversaires : même échelle fixe pour toutes, du présentoir à la
  ligne de service, sans caméra (`MINI_VIEW_FLOORS` dans `render.ts`), pour que
  les tours se comparent d'un coup d'œil. Chaque vignette porte le rang, les
  étages, les cerises, les effets subis (`statusesOf` dans `session.ts`) et le
  bandeau de visée du malus. Ce qui concerne le joueur lui-même (annonce d'un
  malus reçu, nouvelle carte) s'affiche plus gros et dit l'effet en clair.

## Architecture

TypeScript partout. Trois dossiers de code :

```
shared/    règles (RULES, identifiants de cartes/avatars) et types du protocole réseau
server/    index.ts (Express + Socket.IO, un seul port) ; room.ts (logique d'un salon)
client/    React + Vite
  src/store.ts          socket, état d'application (useSyncExternalStore), actions
  src/theme.ts          palette, textes des cartes, polices
  src/game/tower.ts     simulation Matter.js de MA tour (classe Tower)
  src/game/tuning.ts    TOUS les réglages de sensation de jeu (moteur, matière, chute, repos, cartes)
  src/game/session.ts   boucle de jeu, entrées, envoi réseau, dessin de toutes les tours
  src/game/render.ts    dessin canvas d'une tour (grande ou vignette)
  src/game/pieces.ts    formes, drapeaux réseau, tirage « sac de 7 »
  src/game/audio.ts     sons synthétisés
  src/ui/*.tsx          écrans : Home, Lobby, Game, RoundOverlay, Avatar, CardArt
tests/unit/   vitest : room.test.ts, tower.test.ts, physique.test.ts (stabilité, caramel, cartes)
tests/e2e/    partie.mjs : partie complète dans Chrome (playwright-core) + joueur robot
```

Principes à ne pas casser :

- **Chaque client simule sa propre tour** et envoie son état ~15 fois/s
  (`TowerState` : hauteur, corps, largeur du présentoir, masque d'effets). Le
  serveur relaie aux autres, sans simuler de physique.
- **Le serveur fait autorité** sur : salons, hôte, cerises, offres de cartes,
  validité des cibles, victoire (3 s au-dessus de la ligne, chrono côté serveur),
  score. La hauteur déclarée par le client est acceptée telle quelle : c'est un
  jeu entre amis, choix assumé.
- **`Room` est une machine à états pure** (`lobby → countdown → playing → scores
  → final`). Horloge et hasard sont injectés ; tout ce qui dépend du temps passe
  par `tick()`. Elle n'émet rien elle-même : elle remplit une file que
  `server/index.ts` vide avec `flush()`. C'est ce qui la rend testable.
- **Le rendu du jeu ne passe pas par React.** `GameSession` vit hors de React :
  simulation sur `setInterval` (continue en onglet caché), dessin sur
  `requestAnimationFrame`. React ne gère que les écrans et le HUD, et n'est mis
  à jour que sur événement (jamais à chaque image).
- **Monde physique** : `y` vers le bas, dessus du présentoir à `y = 0`, une case
  = 32 px (`CELL`). Les hauteurs se comptent en « étages » (cases). La part en
  cours de chute est gardée hors du moteur Matter et placée à la main ; elle
  n'y entre qu'au moment où elle se pose, amenée au contact exact de son appui
  et lâchée sans vitesse (même pose en chute lente ou rapide).
- **Physique déterministe et immobile au repos** (`tower.ts`) : pas fixe de
  1/60 s découpé en sous-pas, indépendant de l'écran et de la machine. Un corps
  qui bouge de moins que la tolérance `REST.hold` en un sous-pas est remis en
  place (Matter fait sinon glisser lentement toute part posée de travers) ;
  quand plus rien ne bouge, le moteur s'arrête jusqu'au prochain événement
  (`wake()` : part posée ou retirée, présentoir changé, courant d'air).
- **Caramel = fusion** : la part se soude au premier contact à tout ce qu'elle
  touche ; les parts soudées deviennent UN corps Matter rigide (`rebuild()`),
  statique s'il est soudé au présentoir. La liste `welds` fait foi : retirer une
  part ou rétrécir le plateau défait les soudures et recompose les corps. Ne pas
  revenir à des `Constraint` : elles sont élastiques et font dériver la tour.

## Environnement

- Poste : Windows 11, shell PowerShell (Git Bash disponible). Node 20.10 en
  local, d'où **Vite 6 et Vitest 3** (les versions plus récentes exigent
  Node 22) et **TypeScript 5.9**. L'image Docker utilise `node:22-alpine`.
- Le dossier n'est pas un dépôt git.
- Docker est le seul prérequis pour jouer : la compilation se fait dans l'image
  (build multi-étapes), l'image finale ne contient que `express` et `socket.io`.

```bash
docker compose up -d --build   # construit et lance jeu + tunnel
./lien.sh   |  lien.bat        # affiche uniquement l'URL trycloudflare.com
docker compose down            # arrête tout

npm install
npm run typecheck              # tsc client + serveur
npm test                       # vitest (unitaires)
npm run build && npm start     # serveur local sur le port 3000
npm run test:e2e               # partie complète, BASE_URL=http://localhost:3000 par défaut
```

- `docker-compose.yml` : service `game` (port lié à `127.0.0.1:3000`,
  healthcheck `/health`) et service `tunnel` (`cloudflare/cloudflared`, démarre
  quand `game` est sain). Sans `TUNNEL_TOKEN` : tunnel rapide. Avec
  `TUNNEL_TOKEN` dans `.env` : la commande devient
  `tunnel --no-autoupdate --url http://game:3000 run --token …` (tunnel nommé).
  L'image cloudflared n'a pas de shell : la bascule se fait par interpolation
  Compose `${TUNNEL_TOKEN:+…}`, pas par un script.
- Le test e2e pilote le Chrome installé (`channel: 'chrome'`) ; ses captures
  vont dans `tests/e2e/captures/` (ignoré par git).

## Bonnes pratiques de code

- **Langue** : textes d'interface, commentaires et noms de tests en français ;
  identifiants de code en anglais.
- **Protocole** : tout message réseau est typé dans `shared/protocol.ts`
  (`ClientToServer`, `ServerToClient`). Ajouter un message = l'y déclarer d'abord.
- **Règles** : aucune valeur de règle en dur ; elles vivent dans `shared/rules.ts`
  (côté jeu) ou dans `client/src/game/tuning.ts` (sensation de jeu : physique,
  vitesses, durées des cartes). Après un réglage : `npm test`.
- **Entrées non fiables** : le serveur est joignable depuis Internet. Tout ce qui
  vient d'un socket est `unknown` : vérifier `typeof` avant usage (jamais
  `String(x)` sur une valeur reçue), borner tailles et nombres
  (`sanitizeState`, `cleanName`). Chaque gestionnaire est enveloppé par
  `safely()` ; un message mal formé ne doit jamais faire tomber le processus.
- **Une place = un socket** : `attach()` détache l'ancien socket d'un joueur qui
  se reconnecte, pour que sa déconnexion tardive ne l'élimine pas.
- **Limites** : 80 événements/s par socket, 12 sockets par adresse
  (`cf-connecting-ip` derrière le tunnel), 200 salons, charge utile 32 ko.
- **XSS** : les pseudos ne passent que par du texte React ; pas de
  `dangerouslySetInnerHTML` ni `innerHTML`. La CSP est posée dans `server/index.ts`.
- **État React** : mises à jour immuables via `setState({...})` du store. Les
  actions exportées ne commencent pas par `use` (réservé aux hooks). Tout effet
  nettoie ses écouteurs et minuteurs ; `attach`/`detach` de la session sont
  idempotents (StrictMode monte deux fois).
- **Clavier** : utiliser `event.code` (`Digit1`, `ArrowLeft`), pas `event.key`,
  pour que les chiffres marchent en AZERTY.
- **Canvas** : dessiner en pixels réels (`devicePixelRatio`, plafonné à 2,5) ;
  toutes les tailles sont multipliées par l'échelle `s` de la vue.
- **Pas de `console.log`** ; le serveur écrit sur `process.stdout`/`stderr`.
- **Tests avant de dire « fini »** : `npm run typecheck`, `npm test`, puis
  `npm run test:e2e` contre le conteneur lancé par `docker compose up -d --build`.
  Une nouvelle règle de salon ou une nouvelle carte arrive avec son test unitaire.

### Ajouter une carte

1. Identifiant dans `BONUS` ou `MALUS` (`shared/rules.ts`).
2. Effet dans `Tower.applyCard` (`client/src/game/tower.ts`) + test dans
   `tests/unit/tower.test.ts`.
3. Nom, description et annonce dans `CARDS` (`client/src/theme.ts`).
4. Illustration dans `client/src/ui/CardArt.tsx`, son dans `CARD_SOUNDS`
   (`client/src/game/audio.ts`).
5. Si l'effet est minuté et visible : entrée dans `TimedEffect`, `FX_BITS`,
   `DURATIONS` (`tuning.ts`) et `EFFECT_LABELS`, puis dessin dans `render.ts`.

## Limites connues

- Équilibrage (vitesse de chute, frottements, durées) réglé sans partie réelle
  entre humains : à ajuster après les premiers essais, dans `tuning.ts`.
- Une tour réellement déséquilibrée mais presque à l'arrêt peut mettre plusieurs
  secondes à s'effondrer, par à-coups (environ 1 pose sur 1000 en jeu aléatoire).
- Non vérifié : sons à l'oreille, boutons tactiles sur un vrai téléphone,
  Firefox et Safari, tunnel nommé avec un vrai jeton Cloudflare.
- Les salons vivent en mémoire : ils disparaissent au redémarrage du serveur.
