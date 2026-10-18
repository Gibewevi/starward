import * as THREE from 'three';
import { FEEL } from './feel.js';

/**
 * Lightsaber choreography. Each press of B plays a strike; strikes flow into
 * each other through a graph — every move ends with the blade on one side
 * (high right, left, or low in front) and the next is drawn at random among
 * the moves that start there, never one used just before. After three to six
 * strikes a finisher closes the combo. A press while running opens with a
 * dashing move. Several moves begin with flourishes: moulinets beside the
 * body, a helicopter twirl overhead, wrist rolls. Holding A raises a
 * two-handed guard the hero can walk or run in. Igniting the blade plays a
 * quick draw twirl that never stops the legs.
 *
 * Poses are keyframes in the character's root space (+Z forward, -X is the
 * sword side): the right hand's position, the blade direction, the free hand,
 * a two-handed grip, torso twist and pitch, and a knee bend. They are joined
 * with Catmull-Rom splines, so the blade travels in arcs; twirls then spin the
 * blade around an axis while the wrist circles.
 */
const key = (t, hand, blade, options = {}) => ({ t, hand, blade, left: [0.28, 0.93, 0.02], grip: 0, yaw: 0, pitch: 0, crouch: 0.5, ...options });
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
// Film-style moulinet: the wrist rolls the blade in a near-vertical circle
// beside the body, the hand held up in front of the right shoulder, so the
// blade sweeps past the shoulder on every turn. The circle leans slightly
// forward and opens a little towards the viewer.
const MOULINET = [1, 0.15, 0.25], SHOULDER = [-0.24, 1.12, 0.14];

// Recurring silhouettes the strikes pass through.
const COCKED = (t, extra = {}) => key(t, [-0.24, 1.2, 0.05], [-0.15, 0.85, -0.5], { left: [0.24, 1.0, 0.24], yaw: -0.45, pitch: -0.05, crouch: 0.42, ...extra });
const LOW_LEFT = (t, extra = {}) => key(t, [0.16, 0.8, 0.3], [0.75, -0.55, 0.3], { left: [0.3, 0.93, -0.12], yaw: 0.4, pitch: 0.1, crouch: 0.7, ...extra });
const FRONT_LOW = (t, extra = {}) => key(t, [-0.12, 0.85, 0.38], [-0.3, -0.45, 0.85], { grip: 0.4, pitch: 0.1, crouch: 0.6, ...extra });
const GUARDED = (t, extra = {}) => key(t, [-0.04, 0.98, 0.3], [0.15, 0.96, 0.22], { grip: 1, yaw: 0.2, pitch: 0.04, crouch: 0.55, left: [-0.02, 0.92, 0.3], ...extra });
// The blade held low and back while the free hand wields the Force.
const READY = (t, extra = {}) => key(t, [-0.28, 0.96, 0.06], [-0.55, -0.35, -0.75], { left: [0.3, 0.96, 0.05], crouch: 0.55, ...extra });

export const MOVES = {
  // Diagonal cut from over the right shoulder down to the left hip.
  slash: {
    role: ['opener', 'link'], from: ['R'], to: 'L', duration: 0.46, buffer: 0.18, chain: 0.6, active: [0.36, 0.68], trail: [0.3, 0.8],
    drive: [[0.28, 0.62, 2.1]],
    keys: [
      COCKED(0),
      key(0.28, [-0.2, 1.27, 0.08], [-0.05, 0.98, -0.2], { left: [0.26, 0.98, 0.18], yaw: -0.55, crouch: 0.5 }),
      key(0.5, [0.0, 1.0, 0.42], [0.45, 0.25, 0.86], { left: [0.3, 0.95, -0.04], yaw: 0.1, pitch: 0.12, crouch: 0.8 }),
      key(0.66, [0.18, 0.78, 0.36], [0.85, -0.35, 0.35], { left: [0.32, 0.93, -0.16], yaw: 0.45, pitch: 0.18, crouch: 0.9 }),
      LOW_LEFT(1),
    ],
  },
  // Rising backhand from the left hip to above the right shoulder.
  backhand: {
    role: ['link'], from: ['L', 'F'], to: 'R', duration: 0.44, buffer: 0.15, chain: 0.6, active: [0.36, 0.7], trail: [0.28, 0.82],
    drive: [[0.25, 0.55, 1.8]],
    keys: [
      LOW_LEFT(0),
      key(0.22, [0.2, 0.78, 0.24], [0.8, -0.45, 0.0], { left: [0.32, 0.95, -0.05], yaw: 0.5, crouch: 0.75 }),
      key(0.48, [-0.08, 1.02, 0.45], [-0.4, 0.45, 0.8], { left: [0.3, 0.98, 0.12], yaw: 0, pitch: 0.1, crouch: 0.6 }),
      key(0.66, [-0.32, 1.22, 0.22], [-0.85, 0.5, -0.1], { left: [0.26, 1.0, 0.22], yaw: -0.45, pitch: -0.05, crouch: 0.4 }),
      COCKED(1),
    ],
  },
  // Full turn with the blade held out flat.
  spin: {
    role: ['link'], from: ['R'], to: 'R', duration: 0.62, buffer: 0.2, chain: 0.78, active: [0.3, 0.84], trail: [0.25, 0.9],
    drive: [[0.25, 0.8, 1.4]], spin: [0.28, 0.82, 1],
    keys: [
      COCKED(0),
      key(0.2, [-0.36, 1.0, -0.08], [-0.8, 0.15, -0.55], { left: [0.3, 0.95, 0.2], yaw: -0.6, crouch: 0.8 }),
      key(0.35, [-0.42, 0.98, 0.12], [-0.95, 0.05, 0.3], { left: [0.36, 1.0, -0.05], yaw: -0.1, crouch: 0.85 }),
      key(0.8, [-0.42, 0.98, 0.14], [-0.94, 0.04, 0.34], { left: [0.36, 1.0, -0.05], yaw: 0, crouch: 0.85 }),
      key(1, [-0.3, 1.02, 0.14], [-0.6, 0.6, -0.4], { left: [0.3, 0.97, 0.15], yaw: -0.35, crouch: 0.5 }),
    ],
  },
  // Two moulinets at the right side, a pull back, then a straight thrust.
  twirlThrust: {
    role: ['opener', 'link'], from: ['R'], to: 'F', duration: 0.72, buffer: 0.3, chain: 0.78, active: [0.62, 0.82], trail: [0.02, 0.9],
    drive: [[0.6, 0.85, 3.2]], twirls: [[0.04, 0.5, 2, MOULINET, SHOULDER]],
    keys: [
      key(0, [-0.3, 0.98, 0.12], [-0.5, 0.4, 0.75], { left: [0.26, 0.98, 0.2], yaw: -0.25, crouch: 0.5 }),
      key(0.45, [-0.32, 1.0, 0.1], [-0.5, 0.4, 0.75], { left: [0.27, 0.98, 0.2], yaw: -0.35, crouch: 0.6 }),
      key(0.58, [-0.2, 1.02, -0.02], [-0.15, 0.1, 0.98], { left: [0.3, 0.98, 0.15], yaw: -0.5, crouch: 0.7 }),
      key(0.74, [-0.04, 1.0, 0.5], [0.02, 0.06, 1], { left: [0.3, 0.95, -0.15], yaw: 0.25, pitch: 0.15, crouch: 1 }),
      key(1, [-0.06, 0.95, 0.44], [-0.05, -0.2, 0.98], { left: [0.3, 0.95, -0.1], yaw: 0.2, pitch: 0.1, crouch: 0.8 }),
    ],
  },
  // Vertical cut rising from the floor in front to above the head.
  rising: {
    role: ['link'], from: ['F', 'L'], to: 'R', duration: 0.48, buffer: 0.18, chain: 0.64, active: [0.42, 0.72], trail: [0.3, 0.82],
    drive: [[0.3, 0.6, 1.6]],
    keys: [
      FRONT_LOW(0, { grip: 0 }),
      key(0.25, [-0.06, 0.72, 0.36], [-0.2, -0.9, 0.35], { yaw: 0, pitch: 0.15, crouch: 1 }),
      key(0.55, [-0.14, 1.12, 0.4], [-0.25, 0.9, 0.35], { yaw: -0.25, pitch: -0.1, crouch: 0.4 }),
      key(0.72, [-0.2, 1.3, 0.18], [-0.3, 0.85, -0.45], { yaw: -0.4, pitch: -0.15, crouch: 0.3 }),
      COCKED(1),
    ],
  },
  // A wrist roll overhead, then a flat cut across the chest.
  horizontal: {
    role: ['opener', 'link'], from: ['R'], to: 'L', duration: 0.56, buffer: 0.22, chain: 0.68, active: [0.5, 0.76], trail: [0.0, 0.84],
    drive: [[0.4, 0.7, 2.0]], twirls: [[0.02, 0.28, 1, Z]],
    keys: [
      COCKED(0, { crouch: 0.45 }),
      key(0.3, [-0.36, 1.04, 0.02], [-0.85, 0.15, -0.5], { yaw: -0.65, crouch: 0.6 }),
      key(0.56, [-0.02, 1.02, 0.46], [0.1, 0.05, 1], { left: [0.3, 0.97, 0.0], yaw: 0, pitch: 0.08, crouch: 0.75 }),
      key(0.72, [0.26, 1.0, 0.26], [0.95, 0, 0.3], { left: [0.32, 0.95, -0.15], yaw: 0.6, crouch: 0.75 }),
      key(1, [0.2, 0.98, 0.24], [0.85, 0.2, -0.25], { left: [0.32, 0.95, -0.12], yaw: 0.55, crouch: 0.6 }),
    ],
  },
  // Deep crouch and a reaping cut at knee height.
  lowSweep: {
    role: ['link'], from: ['L'], to: 'R', duration: 0.52, buffer: 0.2, chain: 0.7, active: [0.48, 0.76], trail: [0.35, 0.82],
    drive: [[0.4, 0.7, 1.2]],
    keys: [
      key(0, [0.18, 0.85, 0.3], [0.8, -0.3, 0.3], { yaw: 0.45, crouch: 0.8 }),
      key(0.3, [0.2, 0.64, 0.26], [0.85, -0.5, -0.1], { yaw: 0.55, pitch: 0.25, crouch: 1.3 }),
      key(0.55, [0.0, 0.6, 0.46], [0.1, -0.35, 0.95], { yaw: 0, pitch: 0.3, crouch: 1.4 }),
      key(0.72, [-0.3, 0.64, 0.28], [-0.95, -0.25, 0.2], { yaw: -0.55, pitch: 0.25, crouch: 1.3 }),
      key(1, [-0.3, 0.95, 0.14], [-0.75, 0.3, -0.4], { yaw: -0.45, crouch: 0.6 }),
    ],
  },
  // Two crossing diagonals in one breath: an X carved in the air.
  crossCut: {
    role: ['opener', 'link'], from: ['R'], to: 'R', duration: 0.7, buffer: 0.25, chain: 0.76, active: [0.14, 0.8], trail: [0.08, 0.86],
    drive: [[0.1, 0.65, 1.8]],
    keys: [
      COCKED(0),
      key(0.22, [0.08, 0.92, 0.42], [0.6, -0.2, 0.75], { yaw: 0.15, pitch: 0.12, crouch: 0.8 }),
      key(0.36, [0.12, 1.18, 0.3], [0.4, 0.8, -0.3], { yaw: 0.35, crouch: 0.5 }),
      key(0.58, [-0.1, 0.9, 0.44], [-0.6, -0.25, 0.75], { yaw: -0.2, pitch: 0.12, crouch: 0.85 }),
      key(0.76, [-0.3, 0.82, 0.25], [-0.85, -0.45, 0.2], { yaw: -0.45, crouch: 0.85 }),
      key(1, [-0.3, 1.02, 0.12], [-0.6, 0.6, -0.4], { yaw: -0.4, crouch: 0.5 }),
    ],
  },
  // The blade spins flat above the head like a rotor, then cuts down.
  helicopter: {
    role: ['opener', 'link'], from: ['R', 'L', 'F'], to: 'L', duration: 0.78, buffer: 0.3, chain: 0.8, active: [0.6, 0.84], trail: [0.1, 0.9],
    drive: [[0.55, 0.8, 2.0]], twirls: [[0.12, 0.54, 2, Y]],
    keys: [
      key(0, [-0.2, 1.1, 0.2], [-0.4, 0.5, 0.7], { yaw: -0.2, crouch: 0.4 }),
      key(0.12, [-0.08, 1.4, 0.1], [-0.95, 0.12, 0.2], { left: [0.3, 1.0, 0.1], yaw: -0.1, pitch: -0.15, crouch: 0.3 }),
      key(0.52, [-0.08, 1.4, 0.1], [-0.95, 0.12, 0.2], { left: [0.3, 1.0, 0.1], yaw: -0.1, pitch: -0.15, crouch: 0.3 }),
      key(0.68, [0.02, 1.0, 0.46], [0.35, -0.35, 0.86], { yaw: 0.25, pitch: 0.25, crouch: 0.9 }),
      key(0.82, [0.16, 0.8, 0.34], [0.75, -0.55, 0.3], { left: [0.3, 0.93, -0.12], yaw: 0.45, crouch: 0.9 }),
      LOW_LEFT(1),
    ],
  },
  // Backhand turn the other way, the blade leading on the left.
  reverseSpin: {
    role: ['link'], from: ['L'], to: 'L', duration: 0.66, buffer: 0.22, chain: 0.78, active: [0.3, 0.84], trail: [0.25, 0.9],
    drive: [[0.25, 0.8, 1.4]], spin: [0.28, 0.82, -1],
    keys: [
      LOW_LEFT(0),
      key(0.2, [0.22, 1.0, 0.1], [0.9, 0.1, -0.4], { yaw: 0.6, crouch: 0.8 }),
      key(0.35, [0.24, 0.98, 0.2], [0.95, 0.05, 0.25], { left: [0.0, 0.95, 0.25], yaw: 0.5, crouch: 0.85 }),
      key(0.8, [0.24, 0.98, 0.2], [0.95, 0.05, 0.25], { left: [0.0, 0.95, 0.25], yaw: 0.5, crouch: 0.85 }),
      LOW_LEFT(1, { crouch: 0.6 }),
    ],
  },
  // Finisher: leap, sword raised in both hands, slammed into the floor.
  slam: {
    role: ['finisher'], from: ['R', 'L', 'F'], to: 'F', duration: 0.84, buffer: 1, chain: 2, active: [0.45, 0.66], trail: [0.38, 0.7],
    drive: [[0.18, 0.6, 2.4]], lift: [0.2, 0.6, 0.22], impact: [0.6, 1],
    keys: [
      key(0, [-0.25, 0.95, 0.35], [-0.55, 0.2, 0.8], { left: [0.3, 0.95, 0.1], yaw: -0.1, crouch: 0.6 }),
      key(0.18, [-0.15, 0.95, 0.18], [-0.35, 0.35, -0.85], { grip: 1, yaw: -0.35, crouch: 1 }),
      key(0.42, [-0.04, 1.42, 0.02], [0, 0.55, -0.83], { grip: 1, yaw: -0.1, pitch: -0.2, crouch: 0.2 }),
      key(0.6, [0, 0.82, 0.48], [0, -0.7, 0.72], { grip: 1, pitch: 0.35, crouch: 1 }),
      key(0.8, [0, 0.72, 0.45], [0.02, -0.8, 0.6], { grip: 1, pitch: 0.3, crouch: 1 }),
      FRONT_LOW(1),
    ],
  },
  // Finisher: a spinning leap ending in a two-handed downward cut.
  spinSlam: {
    role: ['finisher'], from: ['R', 'L', 'F'], to: 'F', duration: 0.95, buffer: 1, chain: 2, active: [0.2, 0.78], trail: [0.15, 0.82],
    drive: [[0.15, 0.72, 2.6]], spin: [0.2, 0.6, 1], lift: [0.3, 0.72, 0.3], impact: [0.72, 1],
    keys: [
      key(0, [-0.25, 1.0, 0.2], [-0.6, 0.3, 0.7], { yaw: -0.2, crouch: 0.6 }),
      key(0.15, [-0.36, 1.0, 0.0], [-0.9, 0.1, -0.4], { yaw: -0.6, crouch: 0.9 }),
      key(0.25, [-0.42, 1.0, 0.14], [-0.95, 0.1, 0.3], { left: [0.36, 1.0, -0.05], yaw: -0.2, crouch: 0.6 }),
      key(0.55, [-0.1, 1.42, 0.0], [-0.1, 0.6, -0.8], { grip: 1, yaw: -0.1, pitch: -0.2, crouch: 0.2 }),
      key(0.72, [0, 0.82, 0.48], [0, -0.7, 0.72], { grip: 1, pitch: 0.35, crouch: 1 }),
      key(0.88, [0, 0.72, 0.45], [0.02, -0.8, 0.6], { grip: 1, pitch: 0.3, crouch: 1 }),
      FRONT_LOW(1),
    ],
  },
  // Finisher: a crouch, a rising cut carried into a jump, a moulinet in the air.
  risingLeap: {
    role: ['finisher'], from: ['R', 'L', 'F'], to: 'R', duration: 0.84, buffer: 1, chain: 2, active: [0.36, 0.62], trail: [0.3, 0.86],
    drive: [[0.25, 0.6, 1.5]], lift: [0.32, 0.8, 0.38], impact: [0.8, 0.45], twirls: [[0.6, 0.8, -1, X]],
    keys: [
      key(0, [-0.1, 0.85, 0.35], [-0.2, -0.5, 0.85], { crouch: 0.7 }),
      key(0.22, [-0.12, 0.68, 0.34], [-0.15, -0.95, 0.25], { pitch: 0.2, crouch: 1.3 }),
      key(0.5, [-0.12, 1.36, 0.3], [-0.1, 0.95, 0.3], { left: [0.3, 1.05, 0.05], yaw: -0.1, pitch: -0.25, crouch: 0.1 }),
      key(0.62, [-0.18, 1.42, 0.12], [-0.2, 0.9, -0.4], { left: [0.3, 1.05, 0.05], pitch: -0.25, crouch: 0.1 }),
      COCKED(0.85, { crouch: 0.8 }),
      COCKED(1),
    ],
  },
  // Finisher: three fast moulinets, then a long lunging thrust.
  lunge: {
    role: ['finisher'], from: ['R', 'L', 'F'], to: 'F', duration: 0.8, buffer: 1, chain: 2, active: [0.52, 0.8], trail: [0.0, 0.85],
    drive: [[0.5, 0.78, 6]], impact: [0.62, 0.5], twirls: [[0.02, 0.4, 3, MOULINET, SHOULDER]],
    keys: [
      key(0, [-0.28, 1.0, 0.1], [-0.6, 0.5, 0.6], { yaw: -0.3, crouch: 0.5 }),
      key(0.35, [-0.3, 1.02, 0.06], [-0.6, 0.5, 0.6], { yaw: -0.4, crouch: 0.7 }),
      key(0.48, [-0.18, 1.0, -0.08], [-0.1, 0.05, 0.99], { yaw: -0.6, crouch: 0.9 }),
      key(0.62, [-0.02, 0.98, 0.52], [0, 0, 1], { left: [0.3, 0.95, -0.25], yaw: 0.3, pitch: 0.25, crouch: 1.2 }),
      key(0.85, [-0.02, 0.98, 0.5], [0, 0.02, 1], { left: [0.3, 0.95, -0.25], yaw: 0.3, pitch: 0.25, crouch: 1.2 }),
      FRONT_LOW(1, { grip: 0 }),
    ],
  },
  // Opening while running: a dashing flat cut.
  dash: {
    role: ['run'], from: ['R', 'L', 'F'], to: 'L', duration: 0.5, buffer: 0.18, chain: 0.68, active: [0.45, 0.76], trail: [0.35, 0.85],
    drive: [[0, 0.75, 5.2]],
    keys: [
      key(0, [-0.32, 1.0, 0.05], [-0.75, 0.3, -0.6], { left: [0.26, 0.98, 0.25], yaw: -0.55, crouch: 0.6 }),
      key(0.3, [-0.36, 1.02, 0.12], [-0.9, 0.2, -0.38], { left: [0.28, 0.98, 0.25], yaw: -0.65, pitch: 0.1, crouch: 0.8 }),
      key(0.55, [0, 0.98, 0.46], [0.2, 0.1, 0.97], { left: [0.32, 0.95, 0.02], yaw: 0.05, pitch: 0.18, crouch: 0.9 }),
      key(0.72, [0.26, 0.95, 0.28], [0.95, 0.05, 0.3], { left: [0.32, 0.93, -0.15], yaw: 0.55, pitch: 0.12, crouch: 0.8 }),
      LOW_LEFT(1),
    ],
  },
  // Opening while running: a whirling dash, one full turn on the move.
  runSpin: {
    role: ['run'], from: ['R', 'L', 'F'], to: 'L', duration: 0.6, buffer: 0.2, chain: 0.78, active: [0.22, 0.84], trail: [0.18, 0.88],
    drive: [[0, 0.8, 4.6]], spin: [0.2, 0.8, 1],
    keys: [
      key(0, [-0.34, 1.0, 0.05], [-0.8, 0.2, -0.5], { yaw: -0.5, crouch: 0.6 }),
      key(0.25, [-0.42, 0.98, 0.12], [-0.95, 0.05, 0.3], { left: [0.36, 1.0, -0.05], yaw: -0.1, crouch: 0.85 }),
      key(0.8, [-0.42, 0.98, 0.14], [-0.94, 0.04, 0.34], { left: [0.36, 1.0, -0.05], yaw: 0, crouch: 0.85 }),
      LOW_LEFT(1, { crouch: 0.6 }),
    ],
  },
  // A straight overhead chop, quick and clean.
  overhead: {
    role: ['opener', 'link'], from: ['R', 'F'], to: 'F', duration: 0.42, buffer: 0.15, chain: 0.6, active: [0.38, 0.68], trail: [0.26, 0.8],
    drive: [[0.3, 0.6, 1.8]],
    keys: [
      COCKED(0),
      key(0.3, [-0.08, 1.32, 0.08], [-0.05, 0.6, -0.8], { grip: 1, yaw: -0.15, pitch: -0.15, crouch: 0.35 }),
      key(0.52, [-0.04, 1.08, 0.42], [0, 0.35, 0.94], { grip: 1, yaw: 0, pitch: 0.12, crouch: 0.75 }),
      key(0.7, [-0.03, 0.82, 0.44], [0, -0.75, 0.66], { grip: 1, pitch: 0.3, crouch: 1 }),
      FRONT_LOW(1, { grip: 0.6 }),
    ],
  },
  // From over the left shoulder, a diagonal down to his right hip.
  reverseDiagonal: {
    role: ['link'], from: ['L'], to: 'F', duration: 0.48, buffer: 0.18, chain: 0.64, active: [0.4, 0.72], trail: [0.3, 0.82],
    drive: [[0.3, 0.6, 1.6]],
    keys: [
      LOW_LEFT(0),
      key(0.3, [0.12, 1.25, 0.12], [0.45, 0.8, -0.4], { left: [0.3, 1.0, -0.1], yaw: 0.55, pitch: -0.1, crouch: 0.4 }),
      key(0.52, [-0.02, 1.05, 0.44], [-0.35, 0.3, 0.88], { left: [0.3, 0.97, 0.05], yaw: 0, pitch: 0.12, crouch: 0.75 }),
      key(0.7, [-0.24, 0.84, 0.3], [-0.85, -0.4, 0.35], { left: [0.3, 0.95, 0.15], yaw: -0.45, pitch: 0.18, crouch: 0.9 }),
      FRONT_LOW(1),
    ],
  },
  // RB: quick parries — high, left, right — snapped out of the guard and back.
  parryHigh: {
    role: ['parry'], utility: true, from: ['R', 'L', 'F'], to: 'F', duration: 0.28, buffer: 0.35, chain: 0.6, active: [0.1, 0.55], trail: [0.05, 0.6],
    keys: [
      GUARDED(0),
      key(0.32, [-0.05, 1.28, 0.3], [0.95, 0.25, 0.15], { grip: 0.7, yaw: 0.05, pitch: -0.08, crouch: 0.65, left: [0.12, 1.24, 0.3] }),
      key(0.55, [-0.05, 1.26, 0.3], [0.93, 0.3, 0.15], { grip: 0.7, yaw: 0.05, pitch: -0.06, crouch: 0.62, left: [0.12, 1.22, 0.3] }),
      GUARDED(1),
    ],
  },
  parryLeft: {
    role: ['parry'], utility: true, from: ['R', 'L', 'F'], to: 'F', duration: 0.26, buffer: 0.35, chain: 0.6, active: [0.1, 0.55], trail: [0.05, 0.6],
    keys: [
      GUARDED(0),
      key(0.32, [0.1, 1.02, 0.32], [0.45, 0.88, 0.1], { grip: 0.8, yaw: 0.5, crouch: 0.7 }),
      key(0.55, [0.09, 1.02, 0.32], [0.42, 0.89, 0.12], { grip: 0.8, yaw: 0.45, crouch: 0.66 }),
      GUARDED(1),
    ],
  },
  parryRight: {
    role: ['parry'], utility: true, from: ['R', 'L', 'F'], to: 'F', duration: 0.26, buffer: 0.35, chain: 0.6, active: [0.1, 0.55], trail: [0.05, 0.6],
    keys: [
      GUARDED(0),
      key(0.32, [-0.3, 1.02, 0.28], [-0.45, 0.88, 0.1], { grip: 0.3, yaw: -0.35, crouch: 0.7 }),
      key(0.55, [-0.29, 1.02, 0.28], [-0.42, 0.89, 0.12], { grip: 0.3, yaw: -0.32, crouch: 0.66 }),
      GUARDED(1),
    ],
  },
  // RT: Force push. The free hand coils back to the shoulder, then drives
  // forward, palm out; the power leaves it at the thrust.
  forcePush: {
    role: ['power'], utility: true, power: 'pushAt', from: ['R', 'L', 'F'], to: 'F', duration: 0.56, buffer: 0.5, chain: 0.7, active: [2, 2], trail: [2, 2],
    drive: [[0.38, 0.6, 1.1]],
    keys: [
      READY(0, { left: [0.28, 1.0, 0.1] }),
      READY(0.3, { left: [0.2, 1.08, -0.04], yaw: 0.4, pitch: -0.06, crouch: 0.75 }),
      READY(0.45, { left: [0.1, 1.12, 0.5], yaw: -0.32, pitch: 0.16, crouch: 0.9 }),
      READY(0.7, { left: [0.1, 1.1, 0.47], yaw: -0.26, pitch: 0.12, crouch: 0.8 }),
      READY(1),
    ],
  },
  // LT: Force pull. The free hand reaches out, closes, and yanks back to the
  // chest as the body leans away; the pull starts with the yank.
  forcePull: {
    role: ['power'], utility: true, power: 'pullAt', from: ['R', 'L', 'F'], to: 'F', duration: 0.6, buffer: 0.5, chain: 0.7, active: [2, 2], trail: [2, 2],
    drive: [[0.32, 0.55, -0.9]],
    keys: [
      READY(0),
      READY(0.22, { left: [0.1, 1.12, 0.5], yaw: -0.3, pitch: 0.12, crouch: 0.65 }),
      READY(0.3, { left: [0.1, 1.13, 0.5], yaw: -0.32, pitch: 0.14, crouch: 0.7 }),
      READY(0.5, { left: [0.24, 1.06, -0.02], yaw: 0.42, pitch: -0.16, crouch: 0.85 }),
      READY(0.75, { left: [0.26, 1.02, 0.02], yaw: 0.3, pitch: -0.08, crouch: 0.7 }),
      READY(1),
    ],
  },
  // Not a strike: the twirl that accompanies igniting the blade.
  draw: {
    role: ['flourish'], from: ['R', 'L', 'F'], to: 'F', duration: 0.62, buffer: 0, chain: 0, active: [2, 2], trail: [0.02, 0.78], free: true,
    twirls: [[0.02, 0.74, 2, MOULINET, SHOULDER]],
    keys: [
      key(0, [-0.3, 0.92, 0.18], [-0.45, -0.55, 0.65], { crouch: 0 }),
      key(0.74, [-0.3, 0.92, 0.18], [-0.45, -0.55, 0.65], { crouch: 0 }),
      key(1, [-0.28, 0.9, 0.2], [-0.5, -0.6, 0.6], { crouch: 0 }),
    ],
  },
};
export const GUARD_SPEED = 2.2;
const PARRIES = ['parryHigh', 'parryLeft', 'parryRight'];
const GUARD = key(0, [-0.04, 0.98, 0.3], [0.15, 0.96, 0.22], { grip: 1, yaw: 0.2, pitch: 0.04, crouch: 0.55, left: [-0.02, 0.92, 0.3] });

const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);
const inWindow = (t, [from, to], fade = 0.06) => clamp01((t - from + fade) / fade) * clamp01((to + fade - t) / fade);
const VECTORS = ['hand', 'blade', 'left'], SCALARS = ['grip', 'yaw', 'pitch', 'crouch'];
function createPose() {
  return { hand: new THREE.Vector3(), blade: new THREE.Vector3(0, 1, 0), left: new THREE.Vector3(), grip: 0, yaw: 0, pitch: 0, crouch: 0 };
}
function copyPose(out, pose) {
  for (const name of VECTORS) out[name].copy(pose[name]);
  for (const name of SCALARS) out[name] = pose[name];
  return out;
}
function mixPose(out, a, b, weight) {
  for (const name of VECTORS) out[name].lerpVectors(a[name], b[name], weight);
  for (const name of SCALARS) out[name] = a[name] + (b[name] - a[name]) * weight;
  out.blade.normalize();
  return out;
}
function poseOf(keyframe) {
  const pose = createPose();
  for (const name of VECTORS) pose[name].fromArray(keyframe[name]);
  for (const name of SCALARS) pose[name] = keyframe[name];
  pose.blade.normalize();
  return pose;
}
const catmull = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
const axisVector = new THREE.Vector3(), sideA = new THREE.Vector3(), sideB = new THREE.Vector3(), flat = new THREE.Vector3(), twirlHand = new THREE.Vector3();
const smoothRange = (a, b, value) => ease(clamp01((value - a) / (b - a)));

/** Samples a move at normalised time t; twirls spin the blade around an axis. */
export function sampleMove(move, t, out, variation = 1) {
  const keys = move.keys;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = clamp01((t - k1.t) / (k2.t - k1.t));
  for (const name of VECTORS) out[name].set(...[0, 1, 2].map(axis => catmull(k0[name][axis], k1[name][axis], k2[name][axis], k3[name][axis], u)));
  for (const name of SCALARS) out[name] = catmull(k0[name], k1[name], k2[name], k3[name], u);
  out.yaw *= variation;
  out.blade.normalize();
  for (const [from, to, turns, axis, hand] of move.twirls ?? []) {
    const progress = clamp01((t - from) / (to - from));
    if (progress <= 0) continue;
    const angle = ease(progress) * turns * Math.PI * 2;
    axisVector.fromArray(axis).normalize();
    // While it turns, the blade lies in the circle's plane and the hand may
    // move to where the twirl is performed; both return for the next key.
    const hold = smoothRange(0, 0.15, progress) * (1 - smoothRange(0.85, 1, progress));
    if (hand) out.hand.lerp(twirlHand.fromArray(hand), hold);
    flat.copy(out.blade).addScaledVector(axisVector, -out.blade.dot(axisVector));
    if (flat.lengthSq() > 1e-6) out.blade.lerp(flat.normalize(), hold).normalize();
    out.blade.applyAxisAngle(axisVector, angle);
    // The wrist drives the twirl: the hand circles slightly with the blade.
    sideA.set(axisVector.y, axisVector.z, axisVector.x).cross(axisVector).normalize();
    sideB.crossVectors(axisVector, sideA);
    const radius = 0.025 * Math.sin(Math.PI * progress);
    out.hand.addScaledVector(sideA, Math.sin(angle) * radius).addScaledVector(sideB, (1 - Math.cos(angle)) * radius);
  }
  return out;
}

export class CombatController {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.output = { ...createPose(), weight: 0, guard: 0, lift: 0, spin: 0, drive: 0, inputScale: 1, turnScale: 1, maxSpeed: Infinity, trail: 0, flare: 0, shake: 0, name: null, engaged: false };
    this.guardPose = poseOf(GUARD);
    this.actionPose = createPose();
    this.fromPose = createPose();
    this.lastPose = createPose();
    this.mixed = createPose();
    this.swayPose = createPose();
    this.clock = 0;
    this.history = [];
    // A new number for every combo, so effects can be limited per sequence.
    this.sequence = 0;
    this.fired = null;
    this.reset();
  }
  reset() {
    this.action = null;
    this.time = 0;
    this.hits = 0;
    this.length = 0;
    this.side = null;
    this.queued = false;
    this.recovery = 0;
    this.guard = 0;
    this.cooldown = 0;
    this.started = null;
    this.impacted = false;
    this.output.weight = 0;
    this.output.shake = 0;
    this.output.flare = 0;
  }
  get busy() { return Boolean(this.action) && !this.action.free; }
  get guarding() { return this.guard > 0.5 && !this.busy; }
  /** Name of the move that began since the last call, so the hero can re-aim. */
  takeStart() { const name = this.started; this.started = null; return name; }
  /** Picks the next strike at random among those that start where the last ended. */
  choose({ speed = 0 } = {}) {
    const fresh = this.hits === 0;
    const role = fresh ? (speed > 2.6 ? 'run' : 'opener') : this.hits >= this.length - 1 ? 'finisher' : 'link';
    const ofRole = Object.keys(MOVES).filter(name => MOVES[name].role.includes(role));
    let candidates = fresh ? ofRole : ofRole.filter(name => MOVES[name].from.includes(this.side));
    if (!candidates.length) candidates = ofRole;
    const recent = this.history.slice(-FEEL.attacks.memory);
    const unused = candidates.filter(name => !recent.includes(name));
    if (unused.length) candidates = unused;
    return candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
  }
  /** B pressed. */
  attack({ speed = 0 } = {}) {
    if (this.guarding || this.cooldown > 0) return false;
    if (this.busy) {
      const t = this.time / this.action.duration;
      if (t >= this.action.buffer) this.queued = true;
      return this.queued;
    }
    // Shortly after a strike the combo goes on; otherwise a new one begins.
    if (!(this.recovery > 0 && this.hits > 0)) { this.hits = 0; this.side = null; }
    if (this.hits === 0) { this.length = 3 + Math.floor(this.random() * 4); this.sequence++; }
    this.start(this.choose({ speed }));
    return true;
  }
  /** Drops the current move where it is. */
  cancel() {
    this.interrupt();
    this.action = null;
    this.queued = false;
  }
  // A strike cut short leaves the combo open, to be picked up after a power or a parry.
  interrupt() {
    if (!this.action || this.action.free || this.action.utility) return;
    this.side = this.action.to;
    this.recovery = 0.6;
  }
  /**
   * LT / RT: a Force power, at once, cutting short whatever the blade was
   * doing. takeForce() reports the moment the power leaves the hand.
   */
  power(name) {
    if (!MOVES[name]?.power) return false;
    if (this.action?.power && this.time / this.action.duration < 0.75) return false;
    this.interrupt();
    this.start(name);
    return true;
  }
  /** RB pressed: a quick parry, high, left or right, even out of a strike. */
  parry() {
    if (this.action?.power) return false;
    const options = PARRIES.filter(name => name !== this.lastParry);
    const name = options[Math.floor(this.random() * options.length) % options.length];
    this.lastParry = name;
    this.interrupt();
    this.start(name);
    return true;
  }
  takeForce() { const name = this.fired; this.fired = null; return name; }
  /** The ignition twirl; it never interrupts a strike or the guard. */
  flourish() {
    if (this.action || this.guard > 0.3) return false;
    this.start('draw');
    return true;
  }
  start(name) {
    const move = MOVES[name];
    copyPose(this.fromPose, this.lastPose);
    this.blendFrom = this.output.weight > 0.5 ? 1 : 0;
    // Each strike differs a little: tempo, twist and reach vary. FEEL sets the pace.
    const plain = move.free || move.utility;
    const tempo = plain ? 1 : (0.92 + this.random() * 0.16) * FEEL.attacks.tempo;
    this.action = { name, ...move, duration: move.duration * tempo, variation: plain ? 1 : 0.85 + this.random() * 0.3, push: plain ? 1 : 0.85 + this.random() * 0.35, released: false };
    if (!plain) {
      this.hits++;
      this.history.push(name);
      if (this.history.length > 8) this.history.shift();
    }
    this.time = 0;
    this.queued = false;
    this.impacted = false;
    this.started = name;
  }
  update(dt, { guard = false, speed = 0 } = {}) {
    const out = this.output;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    out.shake = Math.max(0, out.shake - dt * 4);
    out.flare = Math.max(0, out.flare - dt * 5);
    out.lift = 0; out.spin = 0; out.drive = 0; out.trail = 0;
    if (this.action) {
      const action = this.action;
      this.time += dt;
      const t = this.time / action.duration;
      if (this.queued && t >= action.chain && !action.role.includes('finisher')) {
        if (!action.utility) this.side = action.to;
        if (this.hits === 0) this.sequence++;
        this.start(this.choose({ speed }));
      } else if (guard && (action.free || t >= action.active[1])) {
        this.finish();
      } else if (t >= 1) {
        this.finish();
      }
      if (this.action) {
        const current = this.action;
        const time = this.time / current.duration;
        sampleMove(current, time, this.actionPose, current.variation);
        // Chained strikes start from wherever the previous one left the blade.
        if (this.blendFrom) mixPose(this.actionPose, this.fromPose, this.actionPose, ease(clamp01(this.time / 0.09)));
        copyPose(this.lastPose, this.actionPose);
        out.weight = current.free ? clamp01(this.time / 0.1) * clamp01((1 - time) / 0.2) : Math.min(1, out.weight + dt / 0.07);
        for (const [from, to, push] of current.drive ?? []) if (time >= from && time <= to) out.drive = push * current.push * Math.sin(Math.PI * (time - from) / (to - from)) * 1.25;
        if (current.lift) { const [from, to, height] = current.lift; if (time > from && time < to) out.lift = Math.sin(Math.PI * (time - from) / (to - from)) * height; }
        if (current.spin) { const [from, to, turns] = current.spin; out.spin = ease(clamp01((time - from) / (to - from))) * turns * Math.PI * 2; }
        out.trail = inWindow(time, current.trail);
        if (current.impact && !this.impacted && time >= current.impact[0]) { this.impacted = true; out.shake = current.impact[1]; out.flare = 1; }
        if (current.power && !current.released && time >= FEEL.force[current.power]) { current.released = true; this.fired = current.name; }
        out.name = current.name;
      }
    }
    if (!this.action) {
      this.recovery = Math.max(0, this.recovery - dt);
      if (this.recovery === 0) this.hits = 0;
      this.guard += ((guard ? 1 : 0) - this.guard) * (1 - Math.exp(-14 * dt));
      // Out of a strike the arms ease back to the captured motion, unless the
      // guard takes over the pose.
      out.weight = Math.max(this.guard, out.weight - dt / 0.3);
      // A held guard is alive: the hands breathe and the blade wavers.
      const guardPose = copyPose(this.swayPose, this.guardPose);
      guardPose.hand.x += Math.sin(this.clock * 1.7) * 0.008;
      guardPose.hand.y += Math.sin(this.clock * 2.3) * 0.006;
      guardPose.blade.x += Math.sin(this.clock * 1.3) * 0.05;
      guardPose.blade.normalize();
      mixPose(this.mixed, this.lastPose, guardPose, out.weight > 0 ? clamp01(this.guard / out.weight) : 1);
      copyPose(this.actionPose, this.mixed);
      copyPose(this.lastPose, this.mixed);
      out.name = this.guard > 0.5 ? 'guard' : null;
    } else if (!this.action.free) {
      this.guard = 0;
    }
    copyPose(out, this.actionPose);
    out.guard = this.guard;
    const striking = this.busy;
    // Powers and parries let the hero keep moving a little; strikes commit him.
    out.inputScale = striking ? (this.action.utility ? 0.5 : 0.15) : 1;
    out.turnScale = striking ? 0 : this.guard > 0.5 ? 0.6 : 1;
    out.maxSpeed = striking ? Infinity : this.guard > 0.1 ? GUARD_SPEED + (1 - this.guard) * 3 : Infinity;
    out.engaged = Boolean(this.action) || this.guard > 0.1;
    return out;
  }
  finish() {
    const ended = this.action;
    this.action = null;
    if (ended.free || ended.utility) return;
    this.side = ended.to;
    if (ended.role.includes('finisher')) { this.hits = 0; this.recovery = 0; this.cooldown = 0.2; }
    else this.recovery = 0.34;
  }
}
