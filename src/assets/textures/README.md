# Textures

Les textures du jeu (tapis, jupe du ring, panneau LED, halos) sont générées au lancement
dans `src/world/Textures.js`. Pour utiliser une image, placez-la ici et remplacez la
fonction correspondante par un `TextureLoader` :

```js
import matUrl from '../assets/textures/tapis.jpg';
const tex = new TextureLoader().load(matUrl);
tex.colorSpace = SRGBColorSpace;
```
