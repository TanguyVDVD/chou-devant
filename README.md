# Chou Devant !

Un jeu d'empilement à 2-4 joueurs, en temps réel, dans une cuisine de pâtisserie.
Chacun monte sa pièce montée sur un présentoir trop étroit : les parts de gâteau
tombent, basculent et glissent pour de vrai. Le premier dont la tour atteint la
ligne de service et y tient 3 secondes gagne la manche. La partie se joue en
3 manches gagnantes.

Tu héberges le jeu sur ton PC dans Docker ; tes amis le rejoignent par un lien
Cloudflare, sans rien installer.

## 1. Installer Docker

Il te faut uniquement Docker. Ni Node ni cloudflared ne sont nécessaires sur ta
machine : tout se compile et tourne dans les conteneurs.

- **Windows / macOS** : installe [Docker Desktop](https://www.docker.com/products/docker-desktop/),
  puis lance-le et attends qu'il affiche « Engine running ».
- **Linux** : installe [Docker Engine](https://docs.docker.com/engine/install/)
  et le plugin Compose.

Vérifie dans un terminal :

```bash
docker compose version
```

## 2. Lancer le jeu

Dans le dossier du projet :

```bash
docker compose up -d --build
```

La première fois, compte une à deux minutes (téléchargement des images et
compilation). Deux services démarrent :

| Service  | Rôle                                                              |
|----------|-------------------------------------------------------------------|
| `game`   | le serveur du jeu, sur le port 3000                               |
| `tunnel` | le tunnel Cloudflare, qui démarre dès que `game` est en bonne santé |

Pour tester seul, ouvre <http://localhost:3000> dans deux onglets.

## 3. Récupérer le lien pour les amis

```bash
./lien.sh        # macOS, Linux, Git Bash
lien.bat         # Windows (invite de commandes ou PowerShell : .\lien.bat)
```

Le script affiche uniquement l'adresse, par exemple
`https://quelque-chose.trycloudflare.com`. Envoie-la à tes amis.

Ensuite, dans le jeu : choisis un pseudo, crée un salon, puis utilise
« Copier le lien d'invitation ». Ce lien contient le code du salon, tes amis
arrivent directement dedans.

> L'adresse `trycloudflare.com` change à chaque redémarrage du service
> `tunnel`. Relance `lien.sh` après chaque `docker compose up`.

### Avoir une adresse fixe (facultatif)

1. Crée un tunnel dans le tableau de bord Cloudflare (Zero Trust > Networks >
   Tunnels) et associe-lui un nom de domaine qui pointe vers `http://game:3000`.
2. Copie `.env.example` en `.env` et colle le jeton du tunnel après
   `TUNNEL_TOKEN=`.
3. Relance `docker compose up -d`.

Quand `TUNNEL_TOKEN` est rempli, le tunnel nommé remplace le tunnel rapide.
L'adresse est alors celle que tu as choisie chez Cloudflare.

## 4. Jouer

| Touche                 | Action                                  |
|------------------------|-----------------------------------------|
| `←` `→`                | déplacer la part d'une case             |
| `Maj` + `←` `→`        | déplacer d'une demi-case                |
| `↑`                    | tourner                                 |
| `↓`                    | accélérer la chute                      |
| `Espace`               | jouer le bonus de la carte              |
| `1` `2` `3`            | lancer le malus sur l'adversaire visé   |

Sur téléphone ou tablette, des boutons tactiles apparaissent sous la tour.
On peut aussi cliquer sur un adversaire pour le viser, ou sur sa propre
vignette pour jouer le bonus.

- Chaque part tombée dans le vide coûte une cerise. À zéro cerise sur trois,
  tu es éliminé de la manche.
- Tous les 5 étages, tu gagnes une carte. Elle propose un bonus pour toi **ou**
  un malus pour un adversaire : c'est l'un ou l'autre.

| Bonus              | Effet                                    | Malus            | Effet                                  |
|--------------------|------------------------------------------|------------------|----------------------------------------|
| Caramel            | la prochaine part se soude à la tour     | Part du chef     | sa prochaine part est énorme           |
| Grand plat         | présentoir élargi pendant 10 s           | Motte de beurre  | sa prochaine part glisse               |
| Coup de fourchette | supprime la dernière part posée          | Nuage de farine  | masque le haut de son écran 6 s        |
| Blancs en neige    | chute lente pendant 8 s                  | Baba au rhum     | gauche et droite inversées 5 s         |
|                    |                                          | Courant d'air    | une rafale pousse sa part de côté      |
|                    |                                          | Coup de feu      | ses parts tombent très vite 8 s        |

Si un joueur se déconnecte, il est éliminé de la manche en cours et la partie
continue. En rouvrant le lien (ou en rechargeant la page) dans le même onglet,
il retrouve sa place et rejoue à la manche suivante.

## 5. Arrêter

```bash
docker compose down
```

Les salons ne sont pas sauvegardés : ils disparaissent à l'arrêt.

## 6. Mettre à jour

Après avoir modifié ou récupéré une nouvelle version du code :

```bash
docker compose up -d --build
```

Pour récupérer aussi la dernière version de cloudflared :

```bash
docker compose pull tunnel
docker compose up -d --build
```

## 7. Dépannage

| Symptôme | Que faire |
|----------|-----------|
| `lien.sh` répond « Pas de lien trouvé » | Vérifie que tout tourne avec `docker compose ps`. Le tunnel met parfois quelques secondes : relance le script. Regarde `docker compose logs tunnel`. |
| `port is already allocated` au lancement | Un autre programme occupe le port 3000. Ferme-le, ou remplace `127.0.0.1:3000:3000` par `127.0.0.1:3001:3000` dans `docker-compose.yml` (le jeu sera alors sur <http://localhost:3001>). |
| `game` reste « unhealthy » | Lis `docker compose logs game`, puis reconstruis avec `docker compose up -d --build`. |
| Les amis voient une erreur Cloudflare 1033 ou 502 | Le tunnel a redémarré et l'adresse a changé : relance `lien.sh` et renvoie le nouveau lien. |
| `docker: command not found` ou « cannot connect to the Docker daemon » | Docker Desktop n'est pas démarré. |
| Un ami sur le même Wi-Fi veut jouer sans passer par Internet | Remplace `127.0.0.1:3000:3000` par `3000:3000` dans `docker-compose.yml`, relance, et donne-lui `http://<adresse-IP-de-ton-PC>:3000`. |
| Pas de son | Le son démarre au premier clic. Vérifie aussi le bouton « Couper le son » en haut de l'écran de jeu. |
| Le jeu saccade dans un onglet en arrière-plan | C'est le navigateur qui bride les onglets cachés. Garde l'onglet du jeu au premier plan. |

Voir ce qui se passe :

```bash
docker compose ps            # état des deux services
docker compose logs -f game  # journal du serveur
curl http://localhost:3000/health
```

## Pour bidouiller le code

Le projet est en TypeScript : serveur Node (Express + Socket.IO) dans `server/`,
client React + canvas dans `client/`, règles et types réseau partagés dans
`shared/`. La physique est simulée par Matter.js dans le navigateur de chaque
joueur ; le serveur gère les salons, les cerises, les cartes et valide la
victoire.

Avec Node 20 ou plus (facultatif, Docker suffit pour jouer) :

```bash
npm install
npm test            # tests unitaires (salons, règles, physique)
npm run typecheck
npm run build && npm start
npm run test:e2e    # partie complète pilotée dans Chrome, jeu lancé sur le port 3000
```
