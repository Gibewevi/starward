"""Transcribe staged radio clips and report pronunciation mismatches.

Uses a separate French ASR model as an imperfect but useful quality gate.
It never changes the game assets.
"""

import argparse
import importlib.util
import json
import os
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".voice-cache"))
ASR_CACHE = ROOT / ".voice-cache" / "asr"


def load_script(name):
    path = ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location("radio_generator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize(text):
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(character for character in text if not unicodedata.combining(character))
    homophones = {
        "contacte": "contact", "contacts": "contact", "visuels": "visuel",
        "pret": "pres", "prets": "pres", "caisse": "caisses",
        "sible": "cible", "reperer": "repere", "reperee": "repere",
        "gardez": "garde", "garder": "garde",
        "avance": "avancez", "avancee": "avancez",
        "noire": "noir", "totale": "total",
    }
    return [homophones.get(token, token) for token in re.findall(r"[a-z]+", text.replace("’", "'"))]


def word_errors(expected, heard):
    a, b = normalize(expected), normalize(heard)
    previous = list(range(len(b) + 1))
    for i, token in enumerate(a, 1):
        current = [i]
        for j, other in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (token != other)))
        previous = current
    return previous[-1] / max(1, len(a))


STOPWORDS = {"avec", "dans", "elle", "elles", "leur", "leurs", "nous", "pour", "plus", "sous", "tout", "tous", "vous", "cette", "comme", "mais", "alors", "dont", "sans"}


def missing_content_words(expected, heard):
    spoken = normalize(heard)
    return [
        word for word in normalize(expected)
        if len(word) >= 4 and word not in STOPWORDS
        and max((SequenceMatcher(None, word, token).ratio() for token in spoken), default=0) < .70
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", choices=("chatterbox", "qwen"), default="chatterbox")
    parser.add_argument("--limit", type=int, default=0, help="Audit only the first N available clips")
    args = parser.parse_args()

    import librosa
    import soundfile as sf
    from faster_whisper import WhisperModel

    script = load_script(f"build-radio-voice-{args.engine}.py")
    lines = script.dialogue()
    refs = script.references(script.REFERENCES, True) if args.engine == "chatterbox" else None
    model = WhisperModel("base", device="cpu", compute_type="int8", download_root=str(ASR_CACHE))
    results = []
    for kind, variant, voice, expected in script.entries(lines):
        if args.engine == "chatterbox":
            filename = f"{kind}-{variant}-{voice}-{script.clip_key(kind, expected, voice, refs[voice])}.mp3"
        else:
            filename = script.staged_name(kind, variant, voice, expected)
        path = script.STAGING / filename
        if not path.is_file():
            continue
        audio, rate = sf.read(path, dtype="float32")
        if rate != 16000:
            audio = librosa.resample(audio, orig_sr=rate, target_sr=16000)
        segments, _ = model.transcribe(audio, language="fr", beam_size=5, vad_filter=False)
        heard = " ".join(segment.text.strip() for segment in segments)
        score = word_errors(expected, heard)
        results.append({
            "kind": kind, "variant": variant, "voice": voice, "expected": expected,
            "heard": heard, "wer": round(score, 3), "missing_content": missing_content_words(expected, heard),
            "char_similarity": round(SequenceMatcher(None, " ".join(normalize(expected)), " ".join(normalize(heard))).ratio(), 3),
            "file": filename,
        })
        print(f"{len(results):03} {filename} WER={score:.2f} {heard}", flush=True)
        if args.limit and len(results) >= args.limit:
            break
    output = ROOT / "artifacts" / f"radio-{args.engine}-audit.json"
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Audited {len(results)} clips; {sum(item['wer'] > .25 for item in results)} above 25% WER. {output}")


if __name__ == "__main__":
    main()
