"""Build the game's four native-French radio voices with Qwen3-TTS cloning.

Run --preview for four samples of one line, --all to stage the 144 clips, then
--install to replace active assets only after a complete batch validates.
--all --only kind-variant-voice --force regenerates one poor take for review.
"""

import argparse
import hashlib
import importlib.util
import itertools
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
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MODEL_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
REFERENCES = ROOT / "artifacts" / "radio-voice-references"
STAGING = ROOT / "artifacts" / "radio-qwen-clone-staging"
PREVIEW = ROOT / "artifacts" / "radio-qwen-clone-preview"
PUBLIC = ROOT / "public" / "audio" / "radio"
QUALITY = STAGING / "quality.json"
MAX_WER = .20


def voice_design_helpers():
    path = ROOT / "scripts" / "build-radio-voice-qwen.py"
    spec = importlib.util.spec_from_file_location("qwen_voice_design", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def intelligibility_helpers():
    path = ROOT / "scripts" / "audit-radio-voice-intelligibility.py"
    spec = importlib.util.spec_from_file_location("radio_intelligibility", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def references():
    import soundfile as sf

    source = json.loads((REFERENCES / "sources.json").read_text(encoding="utf-8"))
    prompts = []
    for index, entry in enumerate(source["voices"]):
        path = REFERENCES / f"voice-{index}.wav"
        if entry["voice"] != index or not path.is_file():
            raise ValueError(f"Référence française manquante: voix {index}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Référence vocale modifiée: {path.name}")
        info = sf.info(path)
        if info.channels != 1 or not 6 <= info.duration <= 12:
            raise ValueError(f"Référence incompatible: {path.name}")
        transcript = " ".join(clip["sentence"] for clip in entry["clips"])
        prompts.append((path, transcript, entry["sha256"]))
    if len(prompts) != 4:
        raise ValueError("Quatre locuteurs français distincts sont requis")
    return prompts


def staged_name(kind, variant, voice, text, prompt):
    identity = "|".join((MODEL_ID, MODEL_REVISION, prompt[2], prompt[1], text))
    key = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
    return f"{kind}-{variant}-{voice}-{key}.mp3"


def install(lines, prompts, helpers, chosen_voice=None):
    import numpy as np
    import soundfile as sf

    quality = json.loads(QUALITY.read_text(encoding="utf-8")) if QUALITY.is_file() else {}
    sources = []
    entries = helpers.entries(lines)
    if chosen_voice is not None:
        entries = [entry for entry in entries if entry[2] == chosen_voice]
    for kind, variant, voice, text in entries:
        source = STAGING / staged_name(kind, variant, voice, text, prompts[voice])
        if not source.is_file() or source.stat().st_size < 1000:
            raise ValueError(f"Lot incomplet: {source.name}")
        if not quality.get(source.name, {}).get("accepted"):
            raise ValueError(f"Prononciation non validée: {source.name}")
        audio, rate = sf.read(source, dtype="float32")
        duration = len(audio) / rate
        if rate != 44100 or audio.ndim != 1 or not .65 <= duration <= 12 or np.sqrt(np.mean(audio * audio)) < .035:
            raise ValueError(f"Réplique invalide: {source.name}")
        for output_voice in (range(4) if chosen_voice is not None else (voice,)):
            sources.append((f"{kind}-{variant}-{output_voice}.mp3", source))
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, source in sources:
        shutil.copyfile(source, PUBLIC / name)
    print(f"{len(sources)} voix radio Qwen3-TTS installées.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--preview", action="store_true")
    action.add_argument("--all", action="store_true")
    action.add_argument("--install", action="store_true")
    action.add_argument("--rescore", action="store_true", help="Recalculer les contrôles après mise à jour des homophones")
    parser.add_argument("--only", action="append", help="Choisir kind-variant-voice pour régénérer une prise")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--batch-size", type=int, choices=(1, 2, 3, 4), default=4)
    parser.add_argument("--voice", type=int, choices=(0, 1, 2, 3), help="Une seule voix pour tous les soldats (0 à 3)")
    args = parser.parse_args()

    helpers = voice_design_helpers()
    lines = helpers.dialogue()
    expected = helpers.entries(lines)
    if len(expected) != 144 or "Ã" in lines["contact"][0]:
        raise ValueError("Le dialogue français est manquant ou mal décodé")
    prompts = references()
    if args.install:
        install(lines, prompts, helpers, args.voice)
        return
    if args.rescore:
        scoring = intelligibility_helpers()
        quality = json.loads(QUALITY.read_text(encoding="utf-8")) if QUALITY.is_file() else {}
        for name, result in quality.items():
            if not (STAGING / name).is_file():
                continue
            wer = scoring.word_errors(result["expected"], result["heard"])
            missing = scoring.missing_content_words(result["expected"], result["heard"])
            result.update(wer=round(wer, 3), missing_content=missing, accepted=wer <= MAX_WER and not missing)
        QUALITY.write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{sum(result['accepted'] for result in quality.values())}/{len(quality)} prises acceptées")
        return

    import torch
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("GPU CUDA requis pour la génération locale")
    cached = ROOT / ".voice-cache" / "hub" / "models--Qwen--Qwen3-TTS-12Hz-1.7B-Base" / "snapshots" / MODEL_REVISION
    model_source = str(cached) if cached.is_dir() else MODEL_ID
    model = Qwen3TTSModel.from_pretrained(model_source, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    voice_prompts = [model.create_voice_clone_prompt(ref_audio=str(path), ref_text=transcript)[0]
                     for path, transcript, _ in prompts]
    selected = [("contact", 0, voice, lines["contact"][0]) for voice in range(4)] if args.preview else expected
    if args.voice is not None:
        selected = [entry for entry in selected if entry[2] == args.voice]
    if args.only:
        wanted = set(args.only)
        selected = [entry for entry in selected if f"{entry[0]}-{entry[1]}-{entry[2]}" in wanted]
        if len(selected) != len(wanted):
            raise ValueError(f"Prises introuvables: {wanted - {f'{entry[0]}-{entry[1]}-{entry[2]}' for entry in selected}}")
    destination = PREVIEW if args.preview else STAGING
    if args.all:
        import librosa
        import soundfile as sf
        from faster_whisper import WhisperModel

        scoring = intelligibility_helpers()
        recognizer = WhisperModel("base", device="cpu", compute_type="int8", download_root=str(ROOT / ".voice-cache" / "asr"))
        quality = json.loads(QUALITY.read_text(encoding="utf-8")) if QUALITY.is_file() else {}

        def check(path, expected):
            audio, rate = sf.read(path, dtype="float32")
            if rate != 16000:
                audio = librosa.resample(audio, orig_sr=rate, target_sr=16000)
            segments, _ = recognizer.transcribe(audio, language="fr", beam_size=5, vad_filter=False)
            heard = " ".join(segment.text.strip() for segment in segments)
            wer = scoring.word_errors(expected, heard)
            missing = scoring.missing_content_words(expected, heard)
            return {"expected": expected, "heard": heard, "wer": round(wer, 3), "missing_content": missing, "accepted": wer <= MAX_WER and not missing}

    for _, group in itertools.groupby(enumerate(selected, 1), key=lambda item: (item[1][0], item[1][1], item[1][3])):
        pending = []
        for number, (kind, variant, voice, text) in group:
            target = destination / staged_name(kind, variant, voice, text, prompts[voice])
            if target.is_file() and target.stat().st_size > 1000 and not args.force and (args.preview or quality.get(target.name, {}).get("accepted")):
                print(f"{number}/{len(selected)} cached {target}", flush=True)
            else:
                pending.append((number, voice, text, target))
        attempts = 1 if args.preview else 4
        for attempt in range(1, attempts + 1):
            next_pending = []
            for offset in range(0, len(pending), args.batch_size):
                batch = pending[offset:offset + args.batch_size]
                waveforms, rate = model.generate_voice_clone(
                    text=[item[2] for item in batch], language="French",
                    voice_clone_prompt=[voice_prompts[item[1]] for item in batch],
                )
                for (number, voice, text, target), waveform in zip(batch, waveforms):
                    helpers.encode(waveform, rate, target)
                    if args.preview:
                        print(f"{number}/{len(selected)} {target}", flush=True)
                        continue
                    result = check(target, text)
                    quality[target.name] = result
                    QUALITY.parent.mkdir(parents=True, exist_ok=True)
                    QUALITY.write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    print(f"{number}/{len(selected)} attempt {attempt} WER={result['wer']:.2f} missing={result['missing_content']} {target.name}: {result['heard']}", flush=True)
                    if not result["accepted"]:
                        next_pending.append((number, voice, text, target))
            pending = next_pending
            if not pending:
                break


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
