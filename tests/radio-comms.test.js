import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRadioComms, createRadioDirector, RADIO_LINES } from '../src/radio-comms.js';

test('every contextual subtitle uses the selected fourth voice for all soldiers', () => {
  for (const [kind, lines] of Object.entries(RADIO_LINES)) {
    lines.forEach((_, index) => {
      const selected = readFileSync(new URL(`../public/audio/radio/${kind}-${index}-3.mp3`, import.meta.url));
      for (let voice = 0; voice < 4; voice++) {
        const clip = new URL(`../public/audio/radio/${kind}-${index}-${voice}.mp3`, import.meta.url);
        assert.ok(statSync(clip).size > 1000, `${kind}-${index}-${voice} is missing audio`);
        assert.deepEqual(readFileSync(clip), selected, `${kind}-${index}-${voice} is not the selected voice`);
      }
    });
  }
});

test('urgent reports precede routine orders, and the same event cannot flood the queue', () => {
  const radio = createRadioDirector({ random: () => 0 });
  assert.equal(radio.offer('move', { id: 1 }, 0), true);
  assert.equal(radio.offer('move', { id: 1 }, 0), false);
  assert.equal(radio.offer('blackout', { id: 2 }, 1), true);
  const first = radio.update(0).started;
  assert.equal(first.kind, 'blackout');
  assert.match(first.text, /centrale/i);
  assert.equal(RADIO_LINES[first.kind][first.variant], first.text);
  assert.equal(first.index, 1);
  radio.finishSpeech();
  radio.update(1.5);
  assert.equal(radio.update(4).started?.kind, 'move');
});

test('messages rotate and respect a category cooldown; reset starts clean', () => {
  const radio = createRadioDirector({ random: () => 0 });
  assert.equal(radio.offer('contact'), true);
  const first = radio.update(0).started.text;
  assert.equal(radio.offer('contact'), false);
  radio.update(34);
  assert.equal(radio.offer('contact'), true);
  const second = radio.update(0).started.text;
  assert.notEqual(second, first);
  radio.reset();
  assert.equal(radio.pending, 0);
  assert.equal(radio.current, null);
  assert.equal(radio.offer('contact'), true);
});

test('stale orders are discarded while a long critical message is playing', () => {
  const radio = createRadioDirector({ random: () => 0 });
  radio.offer('critical');
  radio.update(0);
  radio.offer('move');
  radio.update(9);
  assert.equal(radio.pending, 0);
});

test('a power failure interrupts a routine order promptly', () => {
  const radio = createRadioDirector({ random: () => 0 });
  radio.offer('cover');
  radio.update(0);
  radio.offer('blackout');
  const change = radio.update(0.7);
  assert.equal(change.ended, true);
  assert.equal(change.started.kind, 'blackout');
});

test('the owner dying cuts the transmission and removes their queued calls', () => {
  const speaker = { dead: false };
  const radio = createRadioDirector({ random: () => 0 });
  radio.offer('contact', speaker);
  radio.update(0);
  radio.offer('move', speaker);
  speaker.dead = true;
  const change = radio.update(0.02);
  assert.equal(change.cut.speaker, speaker);
  assert.equal(change.current, null);
  assert.equal(radio.pending, 0);
  assert.equal(radio.offer('cover', speaker), false);
});

test('a speaker death severs his audio clip and briefly glitches the portrait', () => {
  const classes = new Set();
  const classList = {
    add: (...items) => items.forEach(item => classes.add(item)),
    remove: (...items) => items.forEach(item => classes.delete(item)),
    contains: item => classes.has(item),
  };
  const portrait = { style: { setProperty() {} } };
  const bust = { style: {} };
  const label = { textContent: '' };
  const message = { textContent: '' };
  const children = new Map([
    ['.radio-portrait', portrait], ['.radio-bust', bust],
    ['.radio-speaker', label], ['.radio-message', message],
  ]);
  const element = { hidden: true, classList, querySelector: selector => children.get(selector) };
  let stops = 0, drops = 0, path;
  const audio = {
    enabled: true,
    radioClip: clipPath => { path = clipPath; return { stop: () => { stops++; } }; },
    radioDrop: () => { drops++; },
  };
  const speaker = { dead: false };
  const radio = createRadioComms({ element, audio, speech: null, random: () => 0 });
  radio.offer('contact', speaker, 2);
  radio.update(0);
  assert.equal(element.hidden, false);
  assert.ok(path.endsWith('contact-0-2.mp3'));
  assert.equal(classList.contains('on'), true);
  speaker.dead = true;
  radio.update(0.02);
  assert.equal(stops, 1);
  assert.equal(drops, 1);
  assert.equal(classList.contains('cut'), true);
  radio.update(0.5);
  assert.equal(element.hidden, true);
  assert.equal(classList.contains('cut'), false);
});

test('routine chatter leaves several silent seconds between transmissions', () => {
  const radio = createRadioDirector({ random: () => 0 });
  radio.offer('move');
  radio.update(0);
  radio.finishSpeech();
  radio.update(1.5);
  radio.offer('flank');
  assert.equal(radio.update(3).started, null);
  assert.equal(radio.update(4).started?.kind, 'flank');
});
