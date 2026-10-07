# Modèles 3D

Les boxeurs sont affichés avec le personnage Mixamo (`src/characters/MixamoBoxerModel.js`),
et retombent sur les primitives (`src/characters/BoxerModel.js`) tant que le fichier n'est pas
chargé, s'il ne se charge pas, ou si le profil n'a pas de `look.model`.

Pour brancher un autre personnage, chargez-le avec `GLTFLoader`
(`three/addons/loaders/GLTFLoader.js`) et reproduisez `BoxerModel.update(dt, fighter)` :
position et orientation de la racine, inclinaisons depuis `fighter.headOffset` /
`bodyOffset`, gants placés sur `fighter.punches.getGloveWorld(main)`, réactions depuis
`fighter.hitReact`. `characters/Rig.js` fournit l'IK à deux os.

## Ring

`ring.glb` est tiré de « Professional Boxing Ring » par A1905
(https://sketchfab.com/3d-models/professional-boxing-ring-a2b5a268fc5149e78ccf4bbe2a64b399),
licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modifications : cordes,
attaches et tapis retirés (remplacés par ceux du jeu), coussins de coin recolorés, mise à
l'échelle, fusion des pièces, textures réduites, géométrie compressée (meshopt).

Pour le régénérer ou préparer un autre ring : téléchargez le modèle au format glTF, puis
`node scripts/optimize-ring.mjs <dossier contenant scene.gltf>` (adaptez les noms de
matières en tête du script pour un autre modèle).

## Personnages

`characters/xbot.glb` : X Bot et 32 clips de boxe de Mixamo (https://www.mixamo.com), utilisés
selon les conditions de Mixamo (intégrés au jeu, pas redistribués séparément).
`characters/MixamoBoxerModel.js` joue les clips (AnimationMixer) puis corrige la pose : gants
sur la trajectoire logique des coups (IK), tête sur la tête logique, pieds au sol.

Clips : `idle`, `step`, `jab`, `cross`, `hookR`, `upperR`, `blockC`, `blockL`, `blockR`,
`headHit1-3`, `bodyHit1-2`, `upperHitLight`, `upperHitHeavy`, `upperHitBig`, `dizzy`, `ko`,
`getUp`, et le jeu de jambes `stepF1-3` / `stepB1-3` / `stepL1-3` / `stepR1-3` (avant,
arrière, gauche, droite × trois amplitudes). Le crochet et l'uppercut gauches sont des
miroirs calculés au chargement. `step` n'est plus qu'un repli si les clips directionnels
manquent.

### Ajouter des clips

Les .fbx Mixamo (personnage « T-pose », animations « Without Skin », 30 i/s) se greffent sur
le fichier existant :

```
node scripts/add-animations.mjs <dossier des .fbx> src/assets/models/characters/xbot.glb out.glb
```

Le tableau `MAP` en tête du script associe chaque fichier Mixamo à son nom de clip ; le script
monte les pistes sur les nœuds que cible déjà un clip du fichier (le .glb contient deux
squelettes, un seul est animé), puis réapplique l'allègement de `optimize-character.mjs`
(pistes d'échelle et translations hors bassin retirées, rééchantillonnage, meshopt). Il est
rejouable : un clip du même nom est remplacé.

Repères utiles pour un nouveau clip :

- unités en centimètres, comme le fichier existant (bassin en garde à ~88 cm) ;
- le `holder` du modèle est tourné de 180°, donc **+Z du clip = avant du jeu** et
  **+X du clip = gauche du jeu** — la nomenclature Mixamo correspond telle quelle ;
- `FBXLoader` retire déjà les deux-points des noms d'os (`mixamorig:Hips` → `mixamorigHips`).

### Jeu de jambes

Les clips de pas sont capturés *avec* leur déplacement, alors que le jeu déplace le boxeur
par sa propre physique et annule la translation de la racine. `characters/Footwork.js`
rattrape l'écart : le déplacement de chaque clip est mesuré au chargement, le mouvement est
réparti sur les quatre directions, et chaque direction joue le palier d'amplitude dont la
vitesse naturelle est la plus proche de ce qu'on lui demande. Un clip mélangé à 50 % ne
déplaçant le corps que de la moitié de son pas, la vitesse visée est divisée par son poids
dans le mélange. Tous les clips actifs partagent une même durée de cycle, et leur phase est
posée à la main (`timeScale = 0`) : sans cela ils dérivent et les jambes se contredisent.

Contrôle du résultat :

```
node scripts/check-footwork.mjs src/assets/models/characters/xbot.glb
```

Le script mesure, pour une série de vitesses, celle que l'animation produit réellement au sol.
Aux vitesses de déplacement en garde, l'écart est de 0 à 17 % selon la direction (l'arrière
est le moins bon). Au sprint sans garde il monte à 40 % : les pas Mixamo plafonnent à ~1,2 m/s
vers l'avant et ~0,7 m/s vers la gauche, contre 2,85 m/s dans le jeu, et on préfère laisser
le pied glisser plutôt que jouer un pas en accéléré (plafond : 2,2×, dans `Footwork.js`).
