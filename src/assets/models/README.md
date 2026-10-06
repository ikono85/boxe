# Modèles 3D

Les boxeurs sont construits en primitives (`src/characters/BoxerModel.js`). Pour un modèle
riggé (glTF/GLB), chargez-le avec `GLTFLoader` (`three/addons/loaders/GLTFLoader.js`) et
reproduisez `BoxerModel.update(dt, fighter)` : position et orientation de la racine,
inclinaisons depuis `fighter.headOffset` / `bodyOffset`, gants placés sur
`fighter.punches.getGloveWorld(main)`, réactions depuis `fighter.hitReact`.

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

`characters/casual.glb`, `beach.glb`, `worker.glb` : « Ultimate Modular Men » par Quaternius
(https://quaternius.com), licence CC0 (domaine public, voir `LICENSE-Quaternius.txt`).
`characters/RiggedBoxerModel.js` les anime à partir de la pose calculée par `BoxerModel`
(IK bras et jambes, colonne, tête) et allonge leurs bras au chargement.
