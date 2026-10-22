import { FEEL } from './feel.js';

/**
 * Men through the great door, when the game calls for them (summon): the
 * door lamp blinks and an alarm sounds; the door slides open; the troopers
 * come out of the corridor one after the other; once the last is through and
 * clear, it closes. update(dt, { entering }) returns what happened: 'alarm',
 * 'open', { type: 'spawn', index } (the game makes the trooper and marches him
 * in), 'close'.
 */
export function createReinforcements({ door } = {}) {
  let phase, clock, queue, index, waves = 0;
  function reset() {
    phase = 'idle';
    waves = 0;
    clock = queue = index = 0;
    if (door) door.alarm = false;
  }
  reset();
  /** `count` men, now (unless the door is already busy). */
  function summon(count) {
    if (!door || phase !== 'idle') return false;
    phase = 'summoned';
    queue = count;
    index = 0;
    waves++;
    return true;
  }
  function update(dt, { entering = 0 } = {}) {
    const events = [];
    if (!door) return events;
    const r = FEEL.reinforce;
    clock -= dt;
    switch (phase) {
      case 'summoned':
        phase = 'alarm';
        clock = r.alarm;
        door.alarm = true;
        events.push('alarm');
        break;
      case 'alarm':
        if (clock <= 0) { phase = 'opening'; door.open(); events.push('open'); }
        break;
      case 'opening':
        if (door.isOpen) { phase = 'spawning'; clock = 0; }
        break;
      case 'spawning':
        if (clock <= 0 && queue > 0) {
          events.push({ type: 'spawn', index: index++ });
          queue--;
          clock = r.spacing;
        }
        if (queue === 0) { phase = 'clearing'; clock = r.linger; }
        break;
      case 'clearing':
        // Shut once the last man is through and clear of the doorway.
        if (entering > 0) clock = Math.max(clock, 0.6);
        if (clock <= 0) { phase = 'closing'; door.close(); door.alarm = false; events.push('close'); }
        break;
      case 'closing':
        if (door.isClosed) phase = 'idle';
        break;
    }
    return events;
  }
  return { update, reset, summon, get phase() { return phase; }, get waves() { return waves; } };
}
