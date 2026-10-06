import { defineConfig } from 'vite';

// Chemins relatifs : le build fonctionne dans n'importe quel sous-dossier.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 6500, // inclut les modèles (ring, personnages)
    // Le modèle du ring est intégré au JavaScript : le jeu reste un seul fichier
    // (version autonome) et ne fait aucune requête réseau.
    assetsInlineLimit: (file) => (file.endsWith('.glb') ? true : undefined),
  },
  server: {
    host: true,
  },
});
