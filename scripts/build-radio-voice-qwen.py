"""Generate intelligible native-French radio voices with Qwen3-TTS VoiceDesign.

--preview creates four versions of the same line without touching the game.
--all renders every dialogue to a staging folder; --install installs a complete
and validated batch. This runs entirely offline after the first model download.
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
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
MODEL_REVISION = "5ecdb67327fd37bb2e042aab12ff7391903235d3"
STAGING = ROOT / "artifacts" / "radio-qwen-staging"
PREVIEW = ROOT / "artifacts" / "radio-qwen-preview"
PUBLIC = ROOT / "public" / "audio" / "radio"
INSTRUCTIONS = (
    "Voix masculine française de France, accent métropolitain naturel. Soldat de trente-cinq ans, grave et ferme. Alerte militaire urgente, débit vif, consonnes très nettes, chaque mot parfaitement intelligible. Pas d’accent anglais, pas de voix synthétique monotone.",
    "Voix masculine française de France, accent métropolitain naturel. Commandant de quarante-cinq ans, baryton plus grave et autoritaire. Alerte militaire urgente, débit vif, consonnes très nettes, chaque mot parfaitement intelligible. Pas d’accent anglais, pas de voix synthétique monotone.",
    "Voix masculine française de France, accent métropolitain naturel. Jeune soldat de vingt-cinq ans, timbre médium plus clair et nerveux. Alerte militaire urgente, débit vif, consonnes très nettes, chaque mot parfaitement intelligible. Pas d’accent anglais, pas de voix synthétique monotone.",
    "Voix masculine française de France, accent métropolitain naturel. Sergent de cinquante-cinq ans, voix basse et sèche, ferme et énergique. Alerte militaire urgente, débit vif, consonnes très nettes, chaque mot parfaitement intelligible. Pas d’accent anglais, pas de voix synthétique monotone.",
)


def dialogue():
    script = 'import { RADIO_LINES } from "./src/radio-comms.js"; console.log(JSON.stringify(RADIO_LINES));'
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)


def entries(lines):
    return [(kind, variant, voice, text) for kind, variants in lines.items() for variant, text in enumerate(variants) for voice in range(4)]


def ffmpeg_executable():
    if executable := shutil.which("ffmpeg"):
        return executable
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def staged_name(kind, variant, voice, text):
    fingerprint = hashlib.sha256("|".join((MODEL_ID, MODEL_REVISION, INSTRUCTIONS[voice], text)).encode("utf-8")).hexdigest()[:12]
    return f"{kind}-{variant}-{voice}-{fingerprint}.mp3"


def encode(waveform, sample_rate, target):
    import numpy as np
    import soundfile as sf

    audio = np.asarray(waveform, dtype="float32")
    if audio.ndim != 1 or not np.all(np.isfinite(audio)) or len(audio) / sample_rate < .65:
        raise ValueError(f"Audio Qwen invalide: {target.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="radio-qwen-") as temporary:
        wav = Path(temporary) / "generated.wav"
        sf.write(wav, audio, sample_rate, subtype="PCM_16")
        result = subprocess.run([
            ffmpeg_executable(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
            "-af", "acompressor=threshold=-23dB:ratio=1.8:attack=8:release=90:makeup=1.5,loudnorm=I=-15:TP=-1.5:LRA=7",
            "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", str(target),
        ], capture_output=True, text=True)
        if result.returncode or not target.is_file() or target.stat().st_size < 1000:
            raise RuntimeError(f"Encodage MP3 impossible: {target.name}: {result.stderr[-500:]}")


def install(lines):
    import numpy as np
    import soundfile as sf

    sources = []
    for kind, variant, voice, text in entries(lines):
        path = STAGING / staged_name(kind, variant, voice, text)
        if not path.is_file():
            raise ValueError(f"Lot incomplet: {path.name}")
        audio, rate = sf.read(path, dtype="float32")
        if rate != 44100 or audio.ndim != 1 or not .65 <= len(audio) / rate <= 12 or np.sqrt(np.mean(audio * audio)) < .035:
            raise ValueError(f"Réplique invalide: {path.name}")
        sources.append((f"{kind}-{variant}-{voice}.mp3", path))
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, source in sources:
        shutil.copyfile(source, PUBLIC / name)
    print(f"{len(sources)} voix Qwen3-TTS installées.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--preview", action="store_true")
    action.add_argument("--all", action="store_true")
    action.add_argument("--install", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    lines = dialogue()
    expected = entries(lines)
    if len(expected) != 144:
        raise ValueError(f"Le jeu attend 144 MP3, {len(expected)} trouvés")
    if args.install:
        install(lines)
        return

    import torch
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("GPU CUDA requis pour cette génération locale")
    cached = ROOT / ".voice-cache" / "hub" / "models--Qwen--Qwen3-TTS-12Hz-1.7B-VoiceDesign" / "snapshots" / MODEL_REVISION
    model_source = str(cached) if cached.is_dir() else MODEL_ID
    model = Qwen3TTSModel.from_pretrained(model_source, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    selected = [("contact", 0, voice, lines["contact"][0]) for voice in range(4)] if args.preview else expected
    destination = PREVIEW if args.preview else STAGING
    for number, (kind, variant, voice, line) in enumerate(selected, 1):
        target = destination / staged_name(kind, variant, voice, line)
        if not args.force and target.is_file() and target.stat().st_size > 1000:
            print(f"{number}/{len(selected)} cached {target}", flush=True)
            continue
        waves, rate = model.generate_voice_design(text=line, language="French", instruct=INSTRUCTIONS[voice])
        encode(waves[0], rate, target)
        print(f"{number}/{len(selected)} {target}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
