import definitions from './materials.json';

export interface MaterialDefinition {
  readonly id: number;
  readonly name: string;
  /** Infinity is reserved for indestructible bedrock; represented as null in JSON. */
  readonly hp: number;
  readonly debrisColor: number;
  readonly sound: string;
  readonly flammable: boolean;
  /** Fraction of fire damage resisted, in the range 0 to 1. */
  readonly fireResistance: number;
}

export const MATERIALS: Readonly<Record<number, MaterialDefinition>> = Object.freeze(Object.fromEntries(
  definitions.map(definition => [definition.id, Object.freeze({ ...definition, hp: definition.hp ?? Infinity })]),
));
