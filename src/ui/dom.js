/**
 * dom.js — petits utilitaires DOM pour l'interface.
 */

/** Crée un élément à partir d'un fragment HTML (premier élément). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Échappe du texte pour l'insérer dans du HTML. */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Formate des secondes en m:ss. */
export function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Nombre avec séparateur de milliers (espace fine). */
export function num(n) {
  return Math.round(n).toLocaleString('fr-FR');
}

/** Pourcentage arrondi. */
export function pct(x) {
  return `${Math.round(x * 100)} %`;
}
