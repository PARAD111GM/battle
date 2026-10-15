import { TUNING } from '../../data/tuning';
import type { Fighter } from '../types';
import type { FighterResult, MatchResults, MatchSettings, MatchState } from './types';

export function createMatchState(): MatchState {
  return { elapsedTicks: 0, ended: false, winnerIds: [], reason: '' };
}

function highest<T>(entries: T[], score: (entry: T) => number): T[] {
  if (entries.length === 0) return [];
  const best = Math.max(...entries.map(score));
  return entries.filter(entry => score(entry) === best);
}

/** Resolve ties explicitly so equal final scores never depend on fighter order. */
export function updateMatch(settings: MatchSettings, state: MatchState, fighters: Fighter[]): void {
  if (state.ended || fighters.length === 0) return;
  let winners: Fighter[] = [];
  let reason = '';
  if (settings.mode === 'stocks') {
    const remaining = fighters.filter(fighter => fighter.stocks > 0);
    // A lone fighter can practice without ending the match on the first tick.
    if (fighters.length > 1 && remaining.length <= 1) {
      winners = remaining;
      reason = 'last-standing';
    }
  } else if (settings.scoreLimit > 0) {
    if (settings.mode === 'team') {
      const scores = teamScores(fighters);
      const teams = highest([...scores.keys()], team => scores.get(team)!);
      if (teams.length > 0 && scores.get(teams[0])! >= settings.scoreLimit) {
        winners = fighters.filter(fighter => teams.includes(fighter.team));
        reason = 'score-limit';
      }
    } else {
      const leaders = highest(fighters, fighter => fighter.combat.kills);
      if (leaders[0].combat.kills >= settings.scoreLimit) {
        winners = leaders;
        reason = 'score-limit';
      }
    }
  }
  if (!reason && settings.timeLimit > 0 && state.elapsedTicks >= Math.ceil(settings.timeLimit * TUNING.tickRate)) {
    reason = 'time-limit';
    if (settings.mode === 'stocks') winners = highest(fighters, fighter => fighter.stocks);
    else if (settings.mode === 'team') {
      const scores = teamScores(fighters);
      const teams = highest([...scores.keys()], team => scores.get(team)!);
      winners = fighters.filter(fighter => teams.includes(fighter.team));
    } else winners = highest(fighters, fighter => fighter.combat.kills);
  }
  if (reason) {
    state.ended = true;
    state.reason = reason;
    state.winnerIds = winners.map(fighter => fighter.id).sort((a, b) => a - b);
  }
}

export function teamScores(fighters: Fighter[]): Map<number, number> {
  const scores = new Map<number, number>();
  for (const fighter of fighters) scores.set(fighter.team, (scores.get(fighter.team) ?? 0) + fighter.combat.kills);
  return scores;
}

export function getMatchResults(state: MatchState, fighters: Fighter[]): MatchResults {
  const rows: FighterResult[] = fighters.map(fighter => ({
    id: fighter.id, name: fighter.name, team: fighter.team,
    kills: fighter.combat.kills, deaths: fighter.combat.deaths,
    damage: Math.round(fighter.combat.damageDealt * 10) / 10,
    shots: fighter.combat.shots, hits: fighter.combat.hits,
    accuracy: fighter.combat.shots > 0 ? Math.min(100, Math.round(fighter.combat.hits / fighter.combat.shots * 1000) / 10) : 0,
    stocks: fighter.stocks, winner: state.winnerIds.includes(fighter.id),
  }));
  rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage || a.deaths - b.deaths || b.accuracy - a.accuracy || a.id - b.id);
  return { elapsedTicks: state.elapsedTicks, reason: state.reason, winnerIds: [...state.winnerIds], fighters: rows, mvpId: rows[0]?.id ?? null };
}
