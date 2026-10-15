export interface MatchSettings {
  mode: 'deathmatch' | 'team' | 'stocks';
  damageMode: 'health' | 'percent';
  /** Duration in seconds; zero disables the timer. */
  timeLimit: number;
  stocks: number;
  /** Individual or team kills needed to win; zero disables the score limit. */
  scoreLimit: number;
  friendlyFire: boolean;
  weaponSet: 'all' | 'melee' | 'guns' | 'custom';
  customWeapons: string[];
}

export interface MatchState {
  elapsedTicks: number;
  ended: boolean;
  winnerIds: number[];
  reason: string;
}

export interface FighterResult {
  id: number;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  damage: number;
  shots: number;
  hits: number;
  /** Percentage in the inclusive range 0–100. */
  accuracy: number;
  stocks: number;
  winner: boolean;
}

export interface MatchResults {
  elapsedTicks: number;
  reason: string;
  winnerIds: number[];
  fighters: FighterResult[];
  mvpId: number | null;
}

export const DEFAULT_MATCH_SETTINGS: Readonly<MatchSettings> = {
  mode: 'deathmatch', damageMode: 'health', timeLimit: 300,
  stocks: 3, scoreLimit: 10, friendlyFire: true, weaponSet: 'all', customWeapons: [],
};

export function createMatchSettings(overrides: Partial<MatchSettings> = {}): MatchSettings {
  const settings = { ...DEFAULT_MATCH_SETTINGS, ...overrides };
  settings.timeLimit = Number.isFinite(settings.timeLimit) ? Math.max(0, settings.timeLimit) : DEFAULT_MATCH_SETTINGS.timeLimit;
  settings.stocks = Number.isFinite(settings.stocks) ? Math.max(1, Math.floor(settings.stocks)) : DEFAULT_MATCH_SETTINGS.stocks;
  settings.scoreLimit = Number.isFinite(settings.scoreLimit) ? Math.max(0, Math.floor(settings.scoreLimit)) : DEFAULT_MATCH_SETTINGS.scoreLimit;
  settings.customWeapons = [...new Set(overrides.customWeapons ?? [])];
  return settings;
}
