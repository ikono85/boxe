# Boxing Arena

Jeu de boxe arcade en vue subjective, jouable dans le navigateur (PC, clavier + souris).
HTML5, CSS3, JavaScript (modules ES), Three.js, Vite. Aucun fichier 3D, image ou son à
télécharger : le ring 3D est intégré au jeu, le reste est généré au lancement (boxeurs en
primitives, textures en canvas, sons synthétisés), et chaque élément peut être remplacé par
de vrais fichiers.

## Lancer le jeu

```bash
npm install
npm run dev               # serveur de développement : http://localhost:5173
npm run build             # build de production dans dist/
npm run preview           # sert dist/
npm run build:standalone  # dist-standalone/boxing-arena.html : un seul fichier, s'ouvre par double-clic
npm run simulate          # banc d'essai sans rendu : esquives + combats IA simulés
npm run optimize:ring <dossier>  # prépare un modèle de ring glTF pour le jeu
```

Node 20.19+ ou 22.12+ (Vite 8). `?debug` dans l'URL expose l'objet du jeu dans la console
(`window.__boxing`).

## Commandes

| Touche | Action |
| --- | --- |
| Z Q S D (ou W A S D, flèches) | Se déplacer |
| Souris | Regarder et viser (tête ou corps) |
| Clic gauche | Jab (gauche) |
| Clic droit | Direct (droit) |
| E / R (ou boutons latéraux de la souris) | Crochet gauche / droit |
| F / G | Uppercut gauche / droit |
| Espace (maintenir) | Garde — en regardant vers le bas : garde basse (protège le corps) |
| Maj + direction | Esquive : côté (Q/D), recul (S), tête baissée (seule ou Z) |
| C | Baisser la tête |
| Échap / P | Pause |
| H | Afficher / masquer l'aide |
| Entrée | Passer la minute de repos |

Les touches sont déclarées par position physique (`KeyboardEvent.code`) dans
`src/config/Controls.js` : ZQSD et WASD fonctionnent quel que soit le clavier.

## Ce qui se passe sur le ring

- **Coups en quatre temps** : anticipation, frappe, impact (gel d'image), retour en garde.
  Chaque main a sa propre animation : pendant que le jab revient, le direct part.
- **Trajectoires réelles** : jab et direct en ligne droite, crochet en arc latéral qui
  traverse la cible, uppercut qui monte sous le menton. Les gants affichés suivent
  exactement la trajectoire utilisée pour détecter l'impact.
- **Tête ou corps** : la visée décide. Les coups au corps font moins de dégâts mais vident
  l'endurance adverse et ralentissent sa récupération ; la garde haute ne les arrête pas.
- **Esquives géométriques** : l'esquive déplace vraiment la tête.
  Esquive latérale → évite directs et uppercuts, pas les crochets.
  Tête baissée → évite directs et crochets, mais un uppercut dans la tête baissée est
  un critique assuré. Recul → met hors de portée. Les coups au corps ne s'esquivent pas
  avec la tête.
- **Garde** : réduit fortement les coups à la tête (85 %), un peu moins contre l'uppercut,
  rien quand on est attaqué de côté. Bloquer coûte de l'endurance ; bloquer à sec brise la
  garde.
- **Endurance** : chaque coup coûte, rater coûte plus. Essoufflé, on frappe moins fort,
  moins vite, on se déplace moins vite. On récupère au repos, moins en se déplaçant,
  encore moins en garde.
- **Contres** : toucher un adversaire pendant son coup (contre), juste après son coup raté
  (punition) ou juste après avoir esquivé / bloqué (riposte) = bonus de dégâts et de
  chances de critique.
- **Critiques, étourdissement, KO** : les coups propres à la tête remplissent une jauge ;
  pleine, le boxeur est sonné (garde baissée, titube). 0 HP = KO.
- **Combos** (fenêtre d'enchaînement courte, anticipation raccourcie) :
  Jab → Direct, Jab → Jab → Direct, Jab → Crochet → Uppercut, Jab → Direct → Crochet,
  Direct → Crochet, Uppercut → Crochet, Double crochet.
- **Rounds** : 1, 3 ou 5 rounds de 60, 90 ou 120 s, minute de repos avec récupération
  partielle et conseil du coin. Sans KO, trois juges notent chaque round (système des
  10 points) : décision unanime, partagée, majoritaire ou match nul.

## L'adversaire

| Niveau | Boxeur | Comportement |
| --- | --- | --- |
| Débutant | Léo « Le Rookie » Martin | Attaque peu, garde souvent, coups très lisibles, se déplace en ligne droite |
| Équilibré | Marco « La Tempête » Reyes | Attaque régulièrement, esquive, bloque, contre parfois, tourne autour de vous |
| Expert | Viktor « Le Marteau » Kral | Analyse vos habitudes (coup favori, enchaînements, esquives préférées), contre, feinte, varie ses coups, gère son souffle et passe à l'attaque dès que vous êtes touché |

L'IA (`src/game/AI.js`) ne triche pas : elle passe par les mêmes règles que le joueur
(endurance, timings, détection). Elle gère la distance, tourne pour ne pas rester dans les
cordes, entre, enchaîne et ressort, récupère quand elle est fatiguée, réagit aux coups
après un temps de réaction propre à chaque niveau.

## Architecture

```text
src/
 ├── main.js                 point d'entrée (polices, WebGL, création du jeu)
 ├── config/                 tout le réglage, sans toucher au code
 │   ├── GameConfig.js       ring, vitesses, endurance, esquives, dégâts, caméra, qualité
 │   ├── Punches.js          coups (timings, dégâts, portée…) et combos
 │   ├── Boxers.js           boxeurs (stats, apparence, fiche) et skins de gants
 │   ├── Difficulty.js       profils d'IA
 │   └── Controls.js         touches
 ├── core/                   EventBus, Input (Pointer Lock), Settings, MathUtils, Random
 ├── game/
 │   ├── Game.js             boucle, états (menu / combat / pause / résultats), branchements
 │   ├── Fighter.js          logique commune : vie, endurance, garde, esquives, stun, KO
 │   ├── Player.js           clavier/souris → intentions, visée tête/corps
 │   ├── Opponent.js         boxeur IA
 │   ├── AI.js               cerveau de l'adversaire
 │   ├── CombatSystem.js     résolution des coups, dégâts, contres, critiques, score
 │   ├── RoundSystem.js      rounds, chrono, pauses, juges, décision
 │   └── MatchStats.js       statistiques
 ├── combat/
 │   ├── PunchSystem.js      machine à états des coups, combos, buffer d'entrée
 │   ├── HitDetection.js     balayage gant / volumes (tête, corps, gardes)
 │   └── StaminaSystem.js    endurance
 ├── characters/             BoxerModel (adversaire + IK), FirstPersonArms (gants FPS), GloveFactory, Rig
 ├── world/                  Arena, Ring (cordes déformables), Lighting, Audience, Textures
 ├── fx/                     CameraRig (secousses, chute KO), ImpactEffects, ScreenEffects
 ├── ui/                     HUD, Menu, PauseMenu, OptionsPanel, RoundOverlay, ResultScreen
 ├── audio/                  AudioManager, SoundLibrary (catalogue), SoundSynth (synthèse)
 ├── styles/main.css
 └── assets/                 models/, textures/, sounds/ (vos fichiers)
```

Principes :

- **Logique et rendu séparés.** `game/` et `combat/` n'utilisent que les maths de Three.js :
  ils tournent dans Node (`npm run simulate`). Les modèles 3D lisent l'état des boxeurs.
- **Bus d'événements.** Le combat publie (`punch:land`, `fighter:ko`, `round:start`…) ;
  le son, le HUD, la caméra et les effets s'abonnent dans `Game._bindEvents()`.
- **Hasard reproductible** (`core/Random.js`, avec graine) : utile pour les replays et un
  futur multijoueur déterministe.
- **Pas d'allocation par frame** dans les boucles chaudes, pools pour les effets,
  public en `InstancedMesh` animé dans le shader.

## Personnaliser

- **Un nouveau boxeur** : une entrée dans `BOXERS` (`config/Boxers.js`), puis
  `opponent: 'sonId'` dans un profil de `Difficulty.js`.
- **Un skin de gants** : une entrée dans `GLOVE_SKINS` ; `gloves: 'sonNom'` sur un boxeur.
- **Un niveau d'IA** : copiez un profil de `Difficulty.js` et ajoutez-le à `DIFFICULTY_ORDER`.
- **Équilibrage** : `Punches.js` (dégâts, coûts, timings) et `GameConfig.js`.
- **Sons** : déposez `impact_head.mp3`, `bell.ogg`… dans `src/assets/sounds/` (liste des
  noms dans `src/assets/sounds/README.md`). Ils remplacent les sons synthétisés au build.
- **Modèles / textures** : `BoxerModel.update()` est la seule interface à reproduire pour
  brancher un modèle riggé (glTF) ; les textures générées sont dans `world/Textures.js`.

## Crédits

- Ring 3D : « Professional Boxing Ring » par A1905
  (https://sketchfab.com/3d-models/professional-boxing-ring-a2b5a268fc5149e78ccf4bbe2a64b399),
  licence CC BY 4.0. Allégé (447 000 → 25 000 triangles) et adapté par
  `scripts/optimize-ring.mjs` ; détails dans `src/assets/models/README.md`.

## Performances

- Objectif 60 FPS : une seule lumière projette des ombres, public instancié (2 appels de
  dessin), effets plein écran en CSS plutôt qu'en post-traitement.
- **Résolution dynamique** : si le jeu passe sous ~47 FPS, la définition interne baisse
  (jusqu'à 55 %) puis remonte quand c'est fluide.
- Qualité **Basse** : ring simplifié en primitives (sans le modèle 3D), sans ombres ni
  projecteurs latéraux, moins de public, de particules et de faisceaux.

## Pistes pour la suite

- **Mode carrière / plusieurs boxeurs** : les profils sont déjà des données ; une
  progression peut modifier `stats` et débloquer des skins.
- **Mode entraînement** : un `Opponent` avec une IA réduite (sac de frappe : `ai.enabled =
  false`) et l'affichage des statistiques en direct.
- **Plusieurs rings** : créer d'autres `Arena` (textures, couleurs, public) et en choisir
  une au lancement.
- **Multijoueur** : la logique est indépendante du rendu et pilotée par intentions
  (`tryPunch`, `tryDodge`, `setGuard`, `setMoveInput`) ; il suffit de les transmettre sur le
  réseau, avec un pas de simulation fixe et une graine commune (`Random.setSeed`).
- **Classement / matchmaking** : `MatchStats` et le score final fournissent déjà les
  données d'un classement.
