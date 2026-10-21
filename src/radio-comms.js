/** Short calls tied to what the squad actually knows. No generated story state. */
export const RADIO_LINES = {
  contact: [
    'Contact visuel ! Il est près des caisses.',
    'Ennemi en vue. Prévenez les autres postes !',
    'Je le vois ! Restez groupés.',
    'Cible repérée. Gardez les issues sous surveillance.',
  ],
  suspicious: [
    'J’ai entendu quelque chose. Vérifiez ce secteur.',
    'Un mouvement, là-bas... Restez attentifs.',
  ],
  lost: [
    'Je l’ai perdu. Restez vigilants.',
    'Plus de visuel. Fouillez les abords.',
    'La cible a disparu. Gardez vos positions.',
    'Je ne le vois plus. Surveillez les angles morts.',
  ],
  move: [
    'Je change de position. Couvrez-moi !',
    'Je progresse. Gardez les yeux ouverts.',
    'On avance par les caisses.',
  ],
  cover: [
    'Je vous couvre. Avancez !',
    'Tenez cette ligne, je couvre l’accès.',
    'Couverture en place. Bougez maintenant.',
  ],
  flank: [
    'Je passe sur le côté. Maintenez la pression.',
    'Je prends l’autre angle. Ne le perdez pas.',
    'Je contourne les caisses. Couvrez-moi.',
  ],
  grenade: [
    'Grenade lancée ! Écartez-vous.',
    'Grenade ! Restez à distance.',
  ],
  down: [
    'Un des nôtres ne répond plus. Vérifiez sa position.',
    'Soldat à terre. Quelqu’un le voit ?',
    'On a perdu un homme. Restez à couvert.',
    'Un poste ne répond plus. Soyez prudents.',
  ],
  blackout: [
    'Il a détruit la centrale ! Allumez vos torches !',
    'Noir total ! Restez groupés !',
    'Plus de courant ! Allumez les lampes et gardez contact.',
  ],
  critical: [
    'On perd le contrôle ! Envoyez toutes les unités disponibles !',
    'On recule ! Demandez du renfort, vite !',
    'Trop d’hommes à terre. Regroupez-vous !',
  ],
  reinforce: [
    'Des renforts arrivent par la grande porte.',
    'Tenez encore un instant. Une autre équipe arrive.',
    'La porte s’ouvre. Laissez passer les renforts !',
  ],
  targetDown: [
    'La cible est tombée. Confirmez avant d’approcher.',
    'Cible neutralisée... Restez à couvert.',
  ],
};

const RULES = {
  contact: [3, 32, 0.55], suspicious: [0, 38, 0.16], lost: [2, 34, 0.5],
  move: [0, 40, 0.14], cover: [0, 40, 0.14], flank: [1, 38, 0.22],
  grenade: [4, 21, 0.75], down: [4, 28, 0.8], blackout: [5, 50, 1],
  critical: [5, 45, 1], reinforce: [2, 35, 0.6], targetDown: [4, 40, 1],
};

/** Selection, priority and throttling are independent of the DOM and speech API. */
export function createRadioDirector({ random = Math.random } = {}) {
  let time = 0, nextAt = 0, current = null, queue = [];
  const lastKind = new Map(), recent = new Map();
  function offer(kind, speaker = null, index = 0) {
    const rule = RULES[kind];
    if (!rule || speaker?.dead || time - (lastKind.get(kind) ?? -Infinity) < rule[1]) return false;
    if (queue.some(item => item.kind === kind)) return false;
    if (random() > rule[2]) return false;
    lastKind.set(kind, time);
    queue.push({ kind, speaker, index, priority: rule[0], queued: time });
    queue.sort((a, b) => b.priority - a.priority || a.queued - b.queued);
    queue = queue.slice(0, 3);
    return true;
  }
  function update(dt) {
    time += Math.max(0, dt);
    let ended = false, started = null, cut = null;
    queue = queue.filter(item => !item.speaker?.dead && time - item.queued < (item.priority >= 4 ? 12 : 8));
    if (current?.speaker?.dead) {
      cut = current;
      current = null;
      nextAt = time + 8;
      ended = true;
    }
    if (current && queue[0]?.priority >= 4 && queue[0].priority > current.priority && time - current.started >= 0.65) {
      current = null;
      nextAt = time;
      ended = true;
    }
    if (current && time >= current.ends) { nextAt = current.ends + (current.priority >= 4 ? 4 : 7); current = null; ended = true; }
    if (!cut && !current && queue.length && (time >= nextAt || queue[0].priority >= 4)) {
      const item = queue.shift(), lines = RADIO_LINES[item.kind];
      const last = recent.get(item.kind) ?? [];
      const candidates = lines.filter(line => !last.includes(line));
      item.text = (candidates.length ? candidates : lines)[Math.floor(random() * (candidates.length || lines.length))];
      item.variant = lines.indexOf(item.text);
      recent.set(item.kind, [...last.slice(-1), item.text]);
      item.started = time;
      item.ends = time + Math.max(2.8, Math.min(6.5, item.text.length / 12 + 1.1));
      current = started = item;
    }
    return { ended, started, current, cut };
  }
  function finishSpeech() { if (current) current.ends = Math.min(current.ends, Math.max(time + 0.75, current.started + 1.4)); }
  function holdSpeech() { if (current && time - current.started < 12) current.ends = Math.max(current.ends, time + 0.35); }
  function reset() { time = nextAt = 0; current = null; queue = []; lastKind.clear(); recent.clear(); }
  return { offer, update, finishSpeech, holdSpeech, reset, get current() { return current; }, get pending() { return queue.length; } };
}

/** One enemy owns each transmission, its world marker, subtitle and voice. */
export function createRadioComms({ element, marker = null, camera = null, audio, random = Math.random, speech = globalThis.speechSynthesis } = {}) {
  const director = createRadioDirector({ random });
  const portrait = element.querySelector('.radio-portrait');
  const bust = element.querySelector('.radio-bust');
  const label = element.querySelector('.radio-speaker');
  const message = element.querySelector('.radio-message');
  let utterance = null, clip = null, carrier = null, spoken = false, muted = false, paused = false, cutLeft = 0;
  function stopSpeech() {
    clip?.stop();
    clip = null;
    carrier?.stop();
    carrier = null;
    if (utterance) speech?.cancel?.();
    utterance = null;
    spoken = false;
    element.classList.remove('speaking');
  }
  function chooseVoice() {
    const french = speech?.getVoices?.().filter(voice => /^fr\b/i.test(voice.lang)) ?? [];
    return french.find(voice => /henri|thomas|paul|hugo|nicolas|alexandre|denis|daniel|arnaud|jean/i.test(voice.name)) ?? french[0] ?? null;
  }
  function speakBrowser(item) {
    const duration = item.ends - item.started;
    carrier = audio.radioCarrier?.(duration);
    if (!speech || typeof SpeechSynthesisUtterance === 'undefined') {
      audio.radio?.(item.speaker?.root?.position ?? null, item.kind, item.speaker);
      return;
    }
    try {
      const voice = new SpeechSynthesisUtterance(item.text);
      voice.lang = 'fr-FR';
      voice.voice = chooseVoice();
      voice.pitch = 0.63;
      voice.rate = 1.06;
      voice.volume = 1;
      voice.onstart = () => { if (utterance === voice) { spoken = true; element.classList.add('speaking'); } };
      voice.onend = () => { if (utterance === voice) { spoken = false; utterance = null; director.finishSpeech(); element.classList.remove('speaking'); } };
      voice.onerror = () => { if (utterance === voice) { spoken = false; utterance = null; director.finishSpeech(); element.classList.remove('speaking'); } };
      utterance = voice;
      speech.speak(voice);
    } catch {
      utterance = null;
      audio.radio?.(item.speaker?.root?.position ?? null, item.kind, item.speaker);
    }
  }
  function speak(item) {
    if (muted || !audio?.enabled) return;
    const handle = audio.radioClip?.(`/audio/radio/${item.kind}-${item.variant}-${item.index % 4}.mp3`, {
      onStart: duration => {
        if (clip !== handle) return;
        spoken = true;
        element.classList.add('speaking');
        carrier = audio.radioCarrier?.(duration);
      },
      onEnd: () => {
        if (clip !== handle) return;
        clip = null;
        spoken = false;
        carrier = null;
        director.finishSpeech();
        element.classList.remove('speaking');
      },
      onError: () => {
        if (clip !== handle) return;
        clip = null;
        speakBrowser(item);
      },
    });
    if (handle) { clip = handle; return; }
    speakBrowser(item);
  }
  function show(item) {
    const index = Math.max(0, item.index) % 4;
    bust.style.backgroundPosition = `${index % 2 ? 100 : 0}% ${index > 1 ? 100 : 0}%`;
    portrait.style.setProperty('--visor-x', `${[61, 64, 60, 57][index]}%`);
    label.textContent = 'SOLDAT';
    message.textContent = item.text.replace(/([.!?])\s+(?=[A-ZÉÀ])/u, '$1\n');
    element.hidden = false;
    element.classList.remove('out', 'cut');
    element.classList.add('on');
    cutLeft = 0;
    speak(item);
  }
  function syncMarker(item) {
    if (!marker) return;
    const speaker = item?.speaker;
    if (!camera || !speaker || speaker.dead) { marker.hidden = true; return; }
    const head = speaker.particle?.('HT')?.position?.clone() ?? speaker.root?.position?.clone();
    if (!head) { marker.hidden = true; return; }
    head.y += 0.48;
    head.project(camera);
    marker.hidden = head.z < -1 || head.z > 1 || Math.abs(head.x) > 0.96 || Math.abs(head.y) > 0.93;
    if (!marker.hidden) {
      marker.style.left = `${Math.round((head.x + 1) * innerWidth / 2 - 10)}px`;
      marker.style.top = `${Math.round((1 - head.y) * innerHeight / 2 - 10)}px`;
    }
  }
  function update(dt) {
    if (paused) return;
    if (cutLeft > 0 && (cutLeft -= dt) <= 0) { element.hidden = true; element.classList.remove('cut', 'on'); }
    if (spoken) director.holdSpeech();
    const change = director.update(dt);
    if (change.cut) {
      stopSpeech();
      audio.radioDrop?.();
      marker && (marker.hidden = true);
      element.classList.add('cut');
      cutLeft = 0.46;
    } else if (change.ended) {
      stopSpeech();
      element.classList.remove('on');
      element.hidden = true;
    }
    if (change.started) show(change.started);
    syncMarker(change.current);
  }
  function offer(kind, speaker = null, index = 0) { return director.offer(kind, speaker, index); }
  function setPaused(value) { paused = value; if (paused) reset(); }
  function reset() { stopSpeech(); director.reset(); element.hidden = true; element.classList.remove('on', 'speaking', 'cut'); if (marker) marker.hidden = true; cutLeft = 0; }
  function setSound(value) { muted = !value; if (muted) stopSpeech(); }
  return { offer, update, reset, setPaused, setSound, director };
}
