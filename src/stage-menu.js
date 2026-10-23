import './stage-menu.css';
import { renderMenuPixels } from './menu-pixels.js';

export function createStageMenu({ onStart, onHelp, onSettings, onFullscreen, isPanelOpen, closePanels, initial = 0 }) {
  const root = document.querySelector('#stage-menu');
  const cards = [...root.querySelectorAll('[data-stage]')];
  const confirm = root.querySelector('#stage-confirm');
  const description = root.querySelector('#stage-description');
  const notice = root.querySelector('#jungle-notice');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let selected = 0, open = true, launching = false, ready = false;
  let padConfirm = false, padDirection = 0, repeatAt = 0, padReady = false;
  let launchTimer = null;

  renderMenuPixels(root);
  for (const card of cards) {
    const particles = card.querySelector('.stage-particles');
    for (let i = 0; i < 9; i++) {
      const spark = document.createElement('i');
      spark.style.setProperty('--i', i);
      particles.append(spark);
    }
    card.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') select(cards.indexOf(card));
    });
    card.addEventListener('focus', () => select(cards.indexOf(card)));
    card.addEventListener('pointermove', event => {
      if (reducedMotion.matches || event.pointerType === 'touch' || launching) return;
      const rect = card.getBoundingClientRect();
      // Integer offsets keep the art moving in pixels, like an arcade attract screen.
      card.style.setProperty('--pan-x', `${Math.round((event.clientX - rect.left) / rect.width * 10 - 5)}px`);
      card.style.setProperty('--pan-y', `${Math.round((event.clientY - rect.top) / rect.height * 8 - 4)}px`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--pan-x'); card.style.removeProperty('--pan-y');
    });
    card.addEventListener('click', () => { select(cards.indexOf(card)); activate(); });
  }

  function select(index, focus = false) {
    if (launching) return;
    selected = (index + cards.length) % cards.length;
    cards.forEach((card, i) => {
      card.classList.toggle('is-selected', selected === i);
      card.setAttribute('aria-pressed', String(selected === i));
    });
    root.dataset.selected = String(selected + 1);
    confirm.disabled = !ready;
    notice.hidden = true;
    description.textContent = selected === 0
      ? 'Infiltrez le hangar. Affrontez l’escouade impériale.'
      : 'Ruines du marais. Détruisez les quatre générateurs.';
    if (focus) cards[selected].focus({ preventScroll: true });
  }

  function activate() {
    if (!ready || launching || !open) return;
    launching = true;
    confirm.disabled = true;
    root.classList.add('is-launching');
    closePanels();
    launchTimer = window.setTimeout(() => {
      open = false;
      root.hidden = true;
      root.classList.remove('is-launching');
      document.body.classList.remove('menu-open');
      launching = false;
      onStart(selected + 1);
    }, reducedMotion.matches ? 0 : 420);
  }

  confirm.addEventListener('click', activate);
  root.querySelector('#menu-help').addEventListener('click', onHelp);
  root.querySelector('#menu-settings').addEventListener('click', onSettings);
  root.querySelector('#menu-fullscreen').addEventListener('click', onFullscreen);

  window.addEventListener('keydown', event => {
    if (!open) return;
    if (isPanelOpen()) {
      if (event.code === 'Escape' || (event.code === 'KeyH' && !['INPUT', 'SELECT'].includes(event.target.tagName))) {
        event.preventDefault(); event.stopImmediatePropagation();
        closePanels(); cards[selected].focus({ preventScroll: true });
      }
      return;
    }
    const navigation = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (navigation.includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) select(selected + (['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1), true);
    } else if (event.code === 'Enter' || event.code === 'Space') {
      // Auxiliary buttons retain their native keyboard activation.
      if (event.target.closest?.('.menu-tools')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) activate();
    } else if (['KeyH', 'KeyF', 'Escape'].includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && event.code === 'KeyH') onHelp();
      if (!event.repeat && event.code === 'KeyF') onFullscreen();
    }
  }, true);

  select(initial);
  return {
    get open() { return open; },
    ready() { ready = true; select(selected); },
    /** Straight into the selected stage (coming back from a switch of level). */
    launch() { activate(); },
    show() {
      window.clearTimeout(launchTimer);
      launching = false; open = true; padReady = false;
      document.title = 'STARWARD — Sélection du stage';
      root.hidden = false;
      root.classList.remove('is-launching', 'is-locked');
      document.body.classList.add('menu-open');
      select(selected, true);
    },
    update(now) {
      if (!open) return;
      const pad = navigator.getGamepads?.()?.find(pad => pad?.connected);
      if (!pad) { padReady = false; return; }
      const pressed = !!pad.buttons[0]?.pressed || !!pad.buttons[9]?.pressed;
      const axis = Math.abs(pad.axes[0] ?? 0) > 0.55 ? Math.sign(pad.axes[0]) : 0;
      const direction = pad.buttons[14]?.pressed ? -1 : pad.buttons[15]?.pressed ? 1 : axis;
      // Require neutral once, including after returning from a running game.
      if (!padReady) { padReady = !pressed && !direction; padConfirm = pressed; padDirection = direction; return; }
      if (!isPanelOpen() && !launching) {
        if (direction && (direction !== padDirection || now >= repeatAt)) {
          select(selected + direction, true); repeatAt = now + (direction !== padDirection ? 400 : 200);
        }
        if (pressed && !padConfirm) activate();
      }
      padConfirm = pressed; padDirection = direction;
    },
  };
}
