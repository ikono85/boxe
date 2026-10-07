# Modèles 3D

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

Il n'y en a plus : boxeurs, arbitre et bras du joueur ont été retirés pour être refaits.
Le combat reste entièrement simulé — `game/Fighter.js` calcule la pose logique et les zones
touchables, `combat/HitDetection.js` et `combat/PunchSystem.js` font la détection — il n'y a
simplement plus rien à l'écran pour le montrer.

Pour rebrancher un personnage, il faut un objet avec `root` (Object3D ajouté à la scène),
`update(dt, fighter, state)` et `dispose()`, instancié dans `game/Game.js`. L'état à lire sur
le `fighter` : `position`, `yaw`, `headOffset` / `bodyOffset`, `punches.getGloveWorld(main)`
pour le point de frappe, `hitReact`, `ko` et `down`.

L'historique git contient la version précédente (personnage Mixamo animé par capture, jeu de
jambes directionnel, arbitre) : voir les commits jusqu'à « Poings nus à la place des gants ».
