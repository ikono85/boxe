/**
 * createBoxerModel.js
 * ------------------------------------------------------------------
 * Choisit le modèle 3D d'un boxeur selon look.model (config/Boxers.js) :
 *  - personnage Mixamo animé par capture (MixamoBoxerModel) ;
 *  - sinon (ou en attendant le chargement) : boxeur en primitives (BoxerModel).
 */

import { MixamoBoxerModel, MIXAMO_MODELS } from './MixamoBoxerModel.js';
import { BoxerModel } from './BoxerModel.js';

export function createBoxerModel(profile) {
  const key = profile.look && profile.look.model;
  if (key && MIXAMO_MODELS[key]) return new MixamoBoxerModel(profile);
  return new BoxerModel(profile);
}
