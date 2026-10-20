import { FEEL, pick } from './feel.js';

/**
 * Reinforcements through the great door, again and again. Every so often
 * (sooner when few are left standing, never past a head count) the door lamp
 * blinks and an alarm sounds; the door slides open; three or four troopers
 * come out of the corridor one after the other; once the last is through and
 * clear, it closes. update(dt, { living, entering }) returns what happened:
 * 'alarm', 'open', { type: 'spawn', index } (the game makes the trooper and
 * marches him in), 'close'.
 */
export function createReinforcements({ door, random = Math.random } = {}) {
  let phase, clock, queue, index, waves = 0;
  function reset() {
    phase = 'wait';
    waves = 0;
    clock = FEEL.reinforce.first;
    queue = index = 0;
    if (door) door.alarm = false;
  }
  reset();
  function update(dt, { living = 0, entering = 0 } = {}) {
    const events = [];
    if (!door) return events;
    const r = FEEL.reinforce;
    clock -= dt;
    switch (phase) {
      case 'wait':
        // Few left standing: the next ones come soon.
        if (living <= r.few) clock = Math.min(clock, r.soon);
        if (clock <= 0) {
          if (living >= r.cap) { clock = 3; break; }
          phase = 'alarm';
          clock = r.alarm;
          door.alarm = true;
          queue = Math.min(Math.round(pick(r.wave, random)), r.cap - living);
          index = 0;
          waves++;
          events.push('alarm');
        }
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
        if (door.isClosed) { phase = 'wait'; clock = pick(r.interval, random); }
        break;
    }
    return events;
  }
  return { update, reset, get phase() { return phase; }, get countdown() { return clock; }, get waves() { return waves; } };
}
