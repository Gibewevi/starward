"""Bake expressive French radio lines; edge-tts is only needed to rebuild assets.

Install: python -m pip install edge-tts
Run from anywhere: python scripts/build-radio-voice-neural.py
The game itself plays the generated MP3 files offline.
"""

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "audio" / "radio"
VOICES = (
    "fr-FR-HenriNeural",
    "fr-FR-RemyMultilingualNeural",
    "fr-CA-AntoineNeural",
    "fr-CA-JeanNeural",
)
URGENT = {"contact", "grenade", "down", "blackout", "critical", "targetDown"}


def dialogue():
    script = 'import { RADIO_LINES } from "./src/radio-comms.js"; console.log(JSON.stringify(RADIO_LINES));'
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


async def generate(semaphore, kind, index, text, voice_index):
    path = OUTPUT / f"{kind}-{index}-{voice_index}.mp3"
    if path.exists() and path.stat().st_size > 1000:
        return
    urgent = kind in URGENT
    rate = (11 if urgent else 3) + (4, -1, 2, -2)[voice_index]
    pitch = (-4, -1, -2, -5)[voice_index] + (3 if urgent else 0)
    volume = 12 if urgent else 5
    async with semaphore:
        for attempt in range(3):
            try:
                voice = edge_tts.Communicate(
                    text, VOICES[voice_index],
                    rate=f"{rate:+d}%", pitch=f"{pitch:+d}Hz", volume=f"{volume:+d}%",
                )
                await voice.save(str(path))
                if path.stat().st_size > 1000:
                    print(path.name, flush=True)
                    return
            except Exception:
                path.unlink(missing_ok=True)
                if attempt == 2:
                    raise
                await asyncio.sleep(2 * (attempt + 1))


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(3)
    await asyncio.gather(*(
        generate(semaphore, kind, index, text, voice_index)
        for kind, lines in dialogue().items()
        for index, text in enumerate(lines)
        for voice_index in range(len(VOICES))
    ))


if __name__ == "__main__":
    asyncio.run(main())
