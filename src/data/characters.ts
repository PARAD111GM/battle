import definitions from './characters.json';

export type CharacterSpecial = 'slam' | 'bullet-time' | 'air-strike' | 'shield-wall';
export interface CharacterDefinition {
  id: string;
  name: string;
  role: string;
  hp: number;
  speedScale: number;
  special: CharacterSpecial;
  color: number;
  description: string;
}

export const CHARACTERS: readonly CharacterDefinition[] = definitions as CharacterDefinition[];
export const getCharacter = (id = 'rivet'): CharacterDefinition => CHARACTERS.find(character => character.id === id) ?? CHARACTERS[0];
