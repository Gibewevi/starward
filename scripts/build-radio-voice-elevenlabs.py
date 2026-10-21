"""Generate the game's four French radio voices with ElevenLabs.

The API key stays in ELEVENLABS_API_KEY, never in browser code or this repo.
Choose four French voices from `--list-voices`, then set ELEVENLABS_VOICE_IDS
to their comma-separated IDs. `--preview` writes audition clips without
changing the game; a full run replaces the active radio assets only once all
clips have been generated successfully.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "audio" / "radio"
STAGING = ROOT / "artifacts" / "radio-elevenlabs-staging"
PREVIEW = ROOT / "artifacts" / "radio-elevenlabs-preview"
API = "https://api.elevenlabs.io"
MODEL = "eleven_v4"
DIRECTIVES = {
    "contact": "[shouts] ",
    "suspicious": "[cautiously] ",
    "lost": "[tense] ",
    "move": "[firmly] ",
    "cover": "[shouts] ",
    "flank": "[urgently] ",
    "grenade": "[shouts] ",
    "down": "[shaken] ",
    "blackout": "[alarmed] ",
    "critical": "[panicked] ",
    "reinforce": "[firmly] ",
    "targetDown": "[cautiously] ",
}


def lines():
    script = 'import { RADIO_LINES } from "./src/radio-comms.js"; console.log(JSON.stringify(RADIO_LINES));'
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


def request(path, key, data=None):
    headers = {"xi-api-key": key}
    if data is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"ElevenLabs HTTP {error.code}: {detail}") from None


def list_voices(key):
    page = None
    while True:
        query = {"language": "fr", "gender": "male", "page_size": "100"}
        if page:
            query["next_page_token"] = page
        result = json.loads(request("/v2/voices?" + urllib.parse.urlencode(query), key))
        for voice in result.get("voices", []):
            labels = voice.get("labels") or {}
            print(f"{voice['voice_id']}  {voice.get('name', 'Sans nom')}  {labels.get('accent', '')}  {voice.get('description', '')[:90]}")
        if not result.get("has_more"):
            return
        page = result.get("next_page_token")
        if not page:
            return


def synthesize(kind, text, voice_id, target, key):
    payload = {
        "text": DIRECTIVES[kind] + text,
        "model_id": MODEL,
        "language_code": "fr",
    }
    path = f"/v1/text-to-speech/{urllib.parse.quote(voice_id)}?output_format=mp3_44100_128"
    audio = request(path, key, payload)
    if len(audio) < 1000 or not audio.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
        raise RuntimeError(f"Réponse audio invalide pour {target.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(audio)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-voices", action="store_true", help="Lister les voix masculines françaises disponibles")
    parser.add_argument("--preview", action="store_true", help="Créer quatre extraits d'essai sans toucher au jeu")
    args = parser.parse_args()

    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        parser.error("ELEVENLABS_API_KEY est absent. Configurez-le dans votre session locale.")
    if args.list_voices:
        list_voices(key)
        return

    voices = [item.strip() for item in os.environ.get("ELEVENLABS_VOICE_IDS", "").split(",") if item.strip()]
    if len(voices) != 4 or len(set(voices)) != 4:
        parser.error("ELEVENLABS_VOICE_IDS doit contenir quatre identifiants de voix distincts, séparés par des virgules.")

    dialogue = lines()
    if args.preview:
        samples = [("contact", 0), ("lost", 0), ("down", 0), ("critical", 0)]
        for voice_index, (kind, variant) in enumerate(samples):
            target = PREVIEW / f"{voice_index}-{kind}.mp3"
            synthesize(kind, dialogue[kind][variant], voices[voice_index], target, key)
            print(target)
        return

    expected = []
    for kind, variants in dialogue.items():
        for variant, text in enumerate(variants):
            for voice_index, voice_id in enumerate(voices):
                name = f"{kind}-{variant}-{voice_index}.mp3"
                fingerprint = hashlib.sha256(f"{MODEL}|{voice_id}|{DIRECTIVES[kind]}|{text}".encode()).hexdigest()[:12]
                target = STAGING / f"{kind}-{variant}-{voice_index}-{fingerprint}.mp3"
                expected.append((name, target))
                if not target.exists() or target.stat().st_size < 1000:
                    synthesize(kind, text, voice_id, target, key)
                    print(target.name, flush=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, path in expected:
        (OUTPUT / name).write_bytes(path.read_bytes())
    print(f"{len(expected)} fichiers ElevenLabs installés dans {OUTPUT}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, urllib.error.URLError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
