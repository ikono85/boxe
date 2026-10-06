/**
 * createBoxerModel.js
 * ------------------------------------------------------------------
 * Choisit le modèle 3D d'un boxeur selon look.model (config/Boxers.js) :
 *  - personnage Mixamo animé par capture (MixamoBoxerModel) ;
 *  - personnage riggé piloté par la pose procédurale (RiggedBoxerModel) ;
 *  - sinon (ou en attendant le chargement) : boxeur en primitives.
 */

import { MixamoBoxerModel, MIXAMO_MODELS } from './MixamoBoxerModel.js';
import { RiggedBoxerModel } from './RiggedBoxerModel.js';

export function createBoxerModel(profile) {
  const key = profile.look && profile.look.model;
  if (key && MIXAMO_MODELS[key]) return new MixamoBoxerModel(profile);
  return new RiggedBoxerModel(profile);
}
