"""Préparer les voix radio françaises avec Chatterbox Multilingual V3.

Sans argument, vérifie les 144 chemins attendus sans charger le modèle.
--preview crée quatre essais dans artifacts/radio-chatterbox-preview/.
--all prépare les 144 MP3 dans artifacts/radio-chatterbox-staging/.
--install copie un lot complet et vérifié dans public/audio/radio/.

Pour quatre locuteurs reconnaissables, déposer quatre références françaises de
6 à 12 secondes dans artifacts/radio-voice-references/voice-0.wav ... voice-3.wav.
L'aperçu peut fonctionner sans références avec la voix intégrée du modèle.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".voice-cache"))
PUBLIC = ROOT / "public" / "audio" / "radio"
STAGING = ROOT / "artifacts" / "radio-chatterbox-staging"
PREVIEW = ROOT / "artifacts" / "radio-chatterbox-preview"
REFERENCES = ROOT / "artifacts" / "radio-voice-references"
MODEL = "Chatterbox Multilingual V3"
MODEL_REVISION = "5de7a54aa4e5e2baadb0182dde554908b48b85c2"
EXCERPTS = tuple(("contact", 0, voice) for voice in range(4))
URGENT = {"contact", "grenade", "down", "blackout", "critical", "targetDown"}
VOICE_DIRECTION = "native-fr-v3-utf8-cfg065-urgent095-tempo110"
FINAL_MASTER = "tight-pauses-v1"


def dialogue():
    js = 'import { RADIO_LINES } from "./src/radio-comms.js"; console.log(JSON.stringify(RADIO_LINES));'
    result = subprocess.run(
        ["node", "--input-type=module", "-e", js],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


def entries(lines):
    return [
        (kind, variant, voice, text)
        for kind, variants in lines.items()
        for variant, text in enumerate(variants)
        for voice in range(4)
    ]


def references(directory, require_four):
    found = []
    for voice in range(4):
        path = directory / f"voice-{voice}.wav"
        found.append(path if path.is_file() else None)
    if require_four and any(path is None for path in found):
        missing = ", ".join(f"voice-{i}.wav" for i, path in enumerate(found) if path is None)
        raise ValueError(f"Références françaises manquantes dans {directory}: {missing}")
    if any(found) and not all(found):
        raise ValueError("Fournir soit les quatre références, soit aucune pour l'aperçu.")
    if all(found):
        import soundfile as sf
        signatures = set()
        for path in found:
            info = sf.info(path)
            if info.channels != 1 or not 6 <= info.duration <= 12:
                raise ValueError(f"{path.name}: référence WAV mono de 6 à 12 secondes requise")
            signatures.add(hashlib.sha256(path.read_bytes()).digest())
        if len(signatures) != 4:
            raise ValueError("Les quatre références vocales doivent être différentes.")
    return found


def ffmpeg_executable():
    if executable := shutil.which("ffmpeg"):
        return executable
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as error:
        raise RuntimeError("FFmpeg absent : installer imageio-ffmpeg dans l'environnement radio.") from error


def clip_key(kind, text, voice, ref):
    identity = ref.read_bytes() if ref else b"built-in-voice"
    payload = b"|".join([
        MODEL.encode(), MODEL_REVISION.encode(), VOICE_DIRECTION.encode(), kind.encode(), text.encode("utf-8"), str(voice).encode(), identity,
    ])
    return hashlib.sha256(payload).hexdigest()[:12]


def tighten_pauses(audio, sample_rate):
    """Shorten only unusually long gaps, keeping brief human breaths intact."""
    import numpy as np

    frame = max(1, round(sample_rate * .02))
    frames = len(audio) // frame
    if frames < 2:
        return audio
    levels = np.sqrt(np.mean(audio[:frames * frame].reshape(frames, frame) ** 2, axis=1))
    threshold = max(.008, min(.018, float(np.sqrt(np.mean(audio * audio))) * .10))
    quiet = levels < threshold
    cuts = []
    start = None
    for index, silent in enumerate(quiet.tolist() + [False]):
        if silent and start is None:
            start = index
        elif not silent and start is not None:
            begin, end = start * frame, min(index * frame, len(audio))
            duration = (end - begin) / sample_rate
            if begin == 0 and duration > .24:
                cuts.append((0, end - round(.08 * sample_rate)))
            elif index == frames and duration > .24:
                cuts.append((begin + round(.10 * sample_rate), end))
            elif duration > .42:
                keep = round(.20 * sample_rate)
                cuts.append((begin + keep // 2, end - keep // 2))
            start = None
    if not cuts:
        return audio
    pieces = []
    position = 0
    for begin, end in cuts:
        if begin > position:
            pieces.append(audio[position:begin])
        position = max(position, end)
    pieces.append(audio[position:])
    return np.concatenate(pieces)


def render(model, ffmpeg, kind, variant, voice, text, ref, directory, force=False):
    key = clip_key(kind, text, voice, ref)
    name = f"{kind}-{variant}-{voice}"
    target = directory / f"{name}-{key}.mp3"
    if target.is_file() and target.stat().st_size > 1000 and not force:
        return target
    directory.mkdir(parents=True, exist_ok=True)
    import soundfile as sf

    expressive = kind in URGENT
    exaggeration = (0.95 if expressive else 0.72) + (0.01 * voice)
    cfg_weight = 0.65 if expressive else 0.68
    kwargs = {
        "text": text,
        "language_id": "fr",
        "exaggeration": exaggeration,
        "cfg_weight": cfg_weight,
    }
    if ref:
        kwargs["audio_prompt_path"] = str(ref)
    waveform = model.generate(**kwargs)
    audio = waveform.detach().cpu().float().squeeze().numpy()
    if audio.size < model.sr // 2:
        raise RuntimeError(f"Chatterbox a produit un son trop court pour {name}")
    audio = tighten_pauses(audio, model.sr)
    with tempfile.TemporaryDirectory(prefix="radio-chatterbox-") as temporary:
        wav = Path(temporary) / f"{name}.wav"
        mp3 = Path(temporary) / f"{name}.mp3"
        sf.write(wav, audio, model.sr, subtype="PCM_16")
        result = subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(wav), "-af",
            f"atempo={1.10 if expressive else 1.06},"
            "acompressor=threshold=-21dB:ratio=2.1:attack=7:release=85:makeup=2,"
            "loudnorm=I=-15:TP=-1.5:LRA=6",
            "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3),
        ], capture_output=True, text=True)
        if result.returncode or not mp3.is_file() or mp3.stat().st_size < 1000:
            raise RuntimeError(f"Encodage MP3 échoué pour {name}: {result.stderr[-600:]}")
        shutil.copyfile(mp3, target)
    return target


def install(lines, refs):
    if not all(refs):
        raise ValueError("L'installation exige quatre références vocales françaises distinctes.")
    import numpy as np
    import soundfile as sf

    expected = entries(lines)
    sources = []
    for kind, variant, voice, text in expected:
        path = STAGING / f"{kind}-{variant}-{voice}-{clip_key(kind, text, voice, refs[voice])}.mp3"
        if not path.is_file() or path.stat().st_size < 1000:
            raise ValueError(f"Lot incomplet : {path.name} manque. Lancer --all d'abord.")
        audio, sr = sf.read(path, dtype="float32")
        if sr != 44100 or audio.ndim != 1 or not 0.6 <= len(audio) / sr <= 20 or np.sqrt(np.mean(audio * audio)) < 0.015:
            raise ValueError(f"MP3 invalide ou quasi silencieux : {path.name}")
        sources.append((f"{kind}-{variant}-{voice}.mp3", path))
    ffmpeg = ffmpeg_executable()
    with tempfile.TemporaryDirectory(prefix="radio-master-") as temporary:
        mastered = []
        for name, source in sources:
            audio, sample_rate = sf.read(source, dtype="float32")
            audio = tighten_pauses(audio, sample_rate)
            wav = Path(temporary) / f"{name}.wav"
            target = Path(temporary) / name
            sf.write(wav, audio, sample_rate, subtype="PCM_16")
            result = subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                "-af", "loudnorm=I=-15:TP=-1.5:LRA=6",
                "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", str(target),
            ], capture_output=True, text=True)
            if result.returncode or not target.is_file() or target.stat().st_size < 1000:
                raise RuntimeError(f"Master radio échoué pour {name}: {result.stderr[-600:]}")
            mastered.append((name, target))
        PUBLIC.mkdir(parents=True, exist_ok=True)
        for name, source in mastered:
            shutil.copyfile(source, PUBLIC / name)
    print(f"{len(sources)} voix Chatterbox installées dans {PUBLIC} ({FINAL_MASTER})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--preview", action="store_true", help="Produire quatre extraits à écouter")
    action.add_argument("--all", action="store_true", help="Préparer les 144 MP3 hors du jeu")
    action.add_argument("--install", action="store_true", help="Installer le lot complet déjà préparé")
    parser.add_argument("--references", type=Path, default=REFERENCES, help="Dossier contenant voice-0.wav à voice-3.wav")
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--force", action="store_true", help="Recréer les fichiers déjà préparés")
    args = parser.parse_args()

    lines = dialogue()
    expected = entries(lines)
    if len(expected) != 144:
        raise ValueError(f"Le jeu attend 144 fichiers, {len(expected)} trouvés : vérifier RADIO_LINES.")
    if not (args.preview or args.all or args.install):
        print(f"{len(lines)} événements, {sum(map(len, lines.values()))} répliques, {len(expected)} MP3 attendus.")
        print("Aucun modèle chargé ni fichier modifié.")
        return

    refs = references(args.references, require_four=args.all or args.install)
    if args.install:
        install(lines, refs)
        return

    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("PyTorch ne voit pas le GPU. Installer sa version CUDA ou utiliser --device cpu.")
    ffmpeg = ffmpeg_executable()
    print(f"Chargement de {MODEL} sur {args.device}...", flush=True)
    model = ChatterboxMultilingualTTS.from_pretrained(device=args.device, t3_model="v3")
    selected = [(kind, variant, voice, lines[kind][variant]) for kind, variant, voice in EXCERPTS] if args.preview else expected
    destination = PREVIEW if args.preview else STAGING
    for number, (kind, variant, voice, text) in enumerate(selected, 1):
        path = render(model, ffmpeg, kind, variant, voice, text, refs[voice], destination, args.force)
        print(f"{number}/{len(selected)} {path}", flush=True)
    if args.preview and not all(refs):
        print("Aperçu avec la voix intégrée ; fournir quatre références pour distinguer les soldats.")
    if args.all:
        print("Lot préparé hors du jeu. Écouter les essais puis lancer --install pour remplacer les voix actives.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
