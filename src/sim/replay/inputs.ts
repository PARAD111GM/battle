import { neutralInput, type InputCommand } from '../types';
import { INPUT_BUTTONS, ReplayError, type RecordedInput } from './types';

export function recordInputs(commands: Readonly<Record<number, InputCommand>>, fighterIds: Set<number>): RecordedInput[] {
  const result: RecordedInput[] = [];
  for (const key of Object.keys(commands)) {
    const id = Number(key);
    if (!Number.isInteger(id) || String(id) !== key || !fighterIds.has(id)) throw new ReplayError('Input references an unknown fighter');
    const input = commands[id];
    if (!input || typeof input !== 'object') throw new ReplayError('Invalid input command');
    const axes = [input.moveX, input.moveY, input.aimX, input.aimY];
    if (axes.some(axis => !Number.isFinite(axis) || Math.abs(axis) > 1)) throw new ReplayError('Input axes must be finite values from -1 to 1');
    let buttons = 0;
    for (const [index, button] of INPUT_BUTTONS.entries()) {
      if (typeof input[button] !== 'boolean') throw new ReplayError('Input buttons must be booleans');
      if (input[button]) buttons |= 1 << index;
    }
    if (!Number.isInteger(input.switchWeapon) || input.switchWeapon < 0 || input.switchWeapon > 4) throw new ReplayError('Invalid weapon-switch command');
    result.push([id, input.moveX, input.moveY, input.aimX, input.aimY, buttons, input.switchWeapon]);
  }
  return result.sort((a, b) => a[0] - b[0]);
}

export function restoreInputs(inputs: RecordedInput[]): Record<number, InputCommand> {
  const commands: Record<number, InputCommand> = {};
  for (const [id, moveX, moveY, aimX, aimY, buttons, switchWeapon] of inputs) {
    const command = { ...neutralInput(), moveX, moveY, aimX, aimY, switchWeapon };
    for (const [index, button] of INPUT_BUTTONS.entries()) command[button] = (buttons & (1 << index)) !== 0;
    commands[id] = command;
  }
  return commands;
}
