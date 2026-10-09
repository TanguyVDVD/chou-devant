// Partie complète de bout en bout : deux onglets de navigateur + un joueur robot.
// Usage : node tests/e2e/partie.mjs   (BASE_URL=http://localhost:3000 par défaut)
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'captures');
const FINISH = 20;
const TIER = 5;
mkdirSync(SHOTS, { recursive: true });

const checks = [];
function ok(label) {
  checks.push(label);
  console.log(`  ok  ${label}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`ÉCHEC : ${label}`);
  ok(label);
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const floors = async (locator) => Number(await locator.locator('.floors strong').first().textContent());

/** Un joueur sans navigateur : il parle directement au serveur. */
function robot(code) {
  const socket = io(BASE_URL, { transports: ['websocket'] });
  let timer = null;
  const joined = new Promise((resolve, reject) => {
    socket.on('connect', () => {
      socket.emit('room:join', { token: 'robot-de-test-0001', name: 'Robot', avatar: 'cannele', code }, (reply) =>
        reply.ok ? resolve(reply) : reject(new Error(reply.error)),
      );
    });
    socket.on('connect_error', reject);
  });
  return {
    joined,
    socket,
    /** Envoie en continu une tour à la hauteur donnée. */
    climbTo(height) {
      clearInterval(timer);
      timer = setInterval(() => socket.volatile.emit('state', { h: height, b: [[1, 0, 16, -16, 0, 0]], bw: 5, fx: 0 }), 100);
    },
    rest() {
      clearInterval(timer);
    },
    stop() {
      clearInterval(timer);
      socket.close();
    },
  };
}

async function main() {
  const health = await fetch(`${BASE_URL}/health`).then((r) => r.json());
  assert(health.status === 'ok', `/health répond "ok" sur ${BASE_URL}`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${who}: ${m.text()}`));
  };

  // --- onglet 1 : Léa crée le salon ---------------------------------------
  const lea = await context.newPage();
  watch(lea, 'Léa');
  await lea.goto(BASE_URL);
  await lea.getByLabel('Ton pseudo').fill('Léa');
  await lea.getByText('Macaron', { exact: true }).click();
  await shot(lea, '01-accueil');
  await lea.getByRole('button', { name: 'Créer un salon' }).click();
  await lea.locator('.invite__code').waitFor();
  const code = (await lea.locator('.invite__code').textContent()).trim();
  assert(/^[A-Z]{4}$/.test(code), `salon créé avec un code à 4 lettres (${code})`);
  assert(lea.url().includes(`salon=${code}`), "l'adresse contient le code du salon");

  // --- onglet 2 : Tom rejoint par le lien ---------------------------------
  const tom = await context.newPage();
  watch(tom, 'Tom');
  await tom.goto(`${BASE_URL}/?salon=${code}`);
  await tom.getByLabel('Ton pseudo').fill('Tom');
  await tom.getByText('Éclair', { exact: true }).click();
  await tom.getByRole('button', { name: `Rejoindre le salon ${code}` }).click();
  await tom.locator('.seat:not(.seat--empty)').nth(1).waitFor();
  assert((await lea.locator('.seat:not(.seat--empty)').count()) === 2, 'les deux onglets sont dans le même salon');

  const start = lea.getByRole('button', { name: 'Lancer la partie' });
  assert(await start.isDisabled(), "l'hôte ne peut pas lancer tant que Tom n'est pas prêt");
  await tom.getByRole('button', { name: 'Je suis prêt' }).click();
  await lea.locator('.seat.is-ready').nth(1).waitFor();
  await shot(lea, '02-salon');
  await start.click();

  // --- manche 1 : physique, synchronisation, cartes, cerises --------------
  await lea.locator('.countdown').waitFor();
  await tom.locator('.countdown').waitFor();
  ok('le décompte démarre dans les deux onglets');
  await lea.locator('.countdown').waitFor({ state: 'detached', timeout: 10000 });

  await lea.bringToFront();
  await lea.keyboard.down('ArrowDown');
  await lea.locator('.card--bonus').waitFor({ timeout: 60000 });
  await lea.keyboard.up('ArrowDown');
  const leaHeight = await floors(lea.locator('.mine'));
  assert(leaHeight >= TIER, `la tour de Léa monte grâce à la physique (${leaHeight} étages) et lui donne une carte`);

  await tom.waitForFunction((tier) => Number(document.querySelector('.rival .floors strong')?.textContent) >= tier, TIER, { timeout: 5000 });
  ok("l'onglet de Tom voit la tour de Léa monter (synchronisation)");
  await shot(lea, '03-jeu-carte-en-main');

  await lea.keyboard.press('Digit1');
  await lea.locator('.toast--malus').waitFor({ timeout: 4000 });
  await tom.locator('.toast--malus').waitFor({ timeout: 4000 });
  const announcement = (await tom.locator('.toast--malus').first().textContent()).trim();
  assert(announcement.includes('Léa') && announcement.includes('Tom'), `malus annoncé chez tout le monde : « ${announcement} »`);
  await shot(tom, '04-malus-recu');

  // Tom jette ses parts dans le vide jusqu'à perdre ses trois cerises.
  await tom.bringToFront();
  await tom.keyboard.down('ArrowDown');
  const deadline = Date.now() + 70000;
  let cherriesSeen = false;
  while (Date.now() < deadline && !(await lea.locator('.overlay').isVisible())) {
    for (let i = 0; i < 7; i += 1) await tom.keyboard.press('ArrowRight');
    await tom.waitForTimeout(350);
    if (!cherriesSeen && (await tom.locator('.mine .cherry--lost').count()) > 0) {
      cherriesSeen = true;
      ok('une part tombée dans le vide coûte une cerise à Tom');
    }
  }
  await tom.keyboard.up('ArrowDown');
  await lea.locator('.overlay').waitFor({ timeout: 5000 });
  const round1 = (await lea.locator('.overlay__title').textContent()).trim();
  assert(cherriesSeen && round1.includes('Léa'), `Tom éliminé à 0 cerise, la manche revient à Léa : « ${round1} »`);
  await shot(lea, '05-scores');

  // --- manche 2 : un troisième joueur arrive et gagne par la ligne --------
  const bot = robot(code);
  await bot.joined;
  ok('un troisième joueur rejoint le salon en cours de partie');
  await lea.locator('.countdown').waitFor({ timeout: 12000 });
  await lea.locator('.countdown').waitFor({ state: 'detached', timeout: 10000 });
  assert((await lea.locator('.rival').count()) === 2, 'la manche suivante démarre seule, avec les trois joueurs');

  bot.climbTo(FINISH + 0.5);
  await lea.waitForTimeout(1500);
  assert(!(await lea.locator('.overlay').isVisible()), 'atteindre la ligne ne suffit pas : il faut tenir 3 secondes');
  await shot(lea, '06-adversaire-sur-la-ligne');
  await lea.locator('.overlay').waitFor({ timeout: 6000 });
  const round2 = (await lea.locator('.overlay__title').textContent()).trim();
  assert(round2.includes('Robot'), `victoire validée par le serveur après 3 s sur la ligne : « ${round2} »`);
  bot.rest();

  // --- manche 3 : déconnexion puis reconnexion ----------------------------
  await lea.locator('.countdown').waitFor({ timeout: 12000 });
  await lea.locator('.countdown').waitFor({ state: 'detached', timeout: 10000 });
  await tom.goto('about:blank');
  await lea.getByText('Tom a quitté la cuisine.').waitFor({ timeout: 5000 });
  assert(!(await lea.locator('.overlay').isVisible()), 'Tom se déconnecte : il est éliminé de la manche, la partie continue');

  await tom.goBack();
  await tom.locator('.game__notice').waitFor({ timeout: 8000 });
  ok('Tom recharge la page et retrouve sa place dans le salon, en spectateur');

  bot.climbTo(FINISH + 1);
  await lea.locator('.overlay').waitFor({ timeout: 8000 });

  // --- manche 4 : fin de partie en 3 manches gagnantes --------------------
  await lea.locator('.countdown').waitFor({ timeout: 12000 });
  await tom.locator('.countdown').waitFor({ timeout: 5000 });
  ok('Tom rejoue à la manche suivante');
  await lea.locator('.overlay--final').waitFor({ timeout: 15000 });
  const final = (await lea.locator('.overlay__title').textContent()).trim();
  assert(final.includes('Robot'), `partie terminée à 3 manches gagnées : « ${final} »`);
  await lea.waitForTimeout(1800);
  await shot(lea, '07-victoire');

  await lea.getByRole('button', { name: 'Retourner au salon' }).click();
  await lea.locator('.invite__code').waitFor();
  await tom.locator('.invite__code').waitFor();
  ok("l'hôte ramène tout le monde au salon pour une revanche");

  bot.stop();
  await browser.close();
  assert(errors.length === 0, `aucune erreur JavaScript dans les onglets${errors.length ? ` (${errors.join(' | ')})` : ''}`);
  console.log(`\n${checks.length} vérifications réussies. Captures : ${SHOTS}`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
