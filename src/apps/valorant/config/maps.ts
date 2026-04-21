import type { StaticMapDefinition } from '../domain/models.js';

export const VALORANT_MAPS: readonly StaticMapDefinition[] = [
  { key: 'abyss', displayName: 'Abyss', aliases: ['abyss'] },
  { key: 'ascent', displayName: 'Ascent', aliases: ['ascent'] },
  { key: 'bind', displayName: 'Bind', aliases: ['bind'] },
  { key: 'breeze', displayName: 'Breeze', aliases: ['breeze'] },
  { key: 'fracture', displayName: 'Fracture', aliases: ['fracture'] },
  { key: 'haven', displayName: 'Haven', aliases: ['haven'] },
  { key: 'icebox', displayName: 'Icebox', aliases: ['icebox'] },
  { key: 'lotus', displayName: 'Lotus', aliases: ['lotus'] },
  { key: 'pearl', displayName: 'Pearl', aliases: ['pearl'] },
  { key: 'split', displayName: 'Split', aliases: ['split'] },
  { key: 'sunset', displayName: 'Sunset', aliases: ['sunset'] },
] as const;

