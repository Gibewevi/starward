"""Render a short offline listening preview of the in-game radio treatment."""

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

from importlib.util import module_from_spec, spec_from_file_location


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "artifacts" / "radio-voice-comparison" / "voix-4.mp3"
OUTPUT = ROOT / "artifacts" / "radio-voice-comparison" / "voix-4-radio.mp3"
spec = spec_from_file_location("qwen_audio_helpers", ROOT / "scripts" / "build-radio-voice-qwen.py")
helpers = module_from_spec(spec)
spec.loader.exec_module(helpers)


def band(audio, low, high, rate):
    return sosfilt(butter(3, [low, high], btype="bandpass", fs=rate, output="sos"), audio)


def main():
    speech, rate = sf.read(SOURCE, dtype="float32")
    if speech.ndim != 1:
        raise ValueError("La voix de comparaison doit être mono")
    lead, tail = int(rate * .11), int(rate * .08)
    samples = lead + len(speech) + tail
    rng = np.random.default_rng(43)
    mix = np.zeros(samples, dtype=np.float32)
    filtered = band(speech, 280, 2950, rate)
    mix[lead:lead + len(speech)] = np.tanh(filtered * 1.7) * .9

    # Pink-ish, narrow-band carrier underneath the words.
    white = rng.normal(0, 1, samples)
    carrier = band(white, 600, 2600, rate)
    carrier /= max(.001, np.std(carrier))
    envelope = np.ones(samples)
    fade = max(1, int(rate * .055))
    envelope[:fade] = np.linspace(0, 1, fade)
    envelope[-fade:] = np.linspace(1, 0, fade)
    mix += carrier * envelope * .009

    # The button click precedes speech, with irregular squelch while the channel is open.
    for at, length, strength in [(0, .075, .14), (len(mix) / rate - .05, .035, .08)]:
        start = int(at * rate)
        count = min(int(length * rate), samples - start)
        t = np.arange(count) / rate
        burst = rng.normal(0, 1, count)
        click = band(burst, 900, 3200, rate)
        mix[start:start + count] += (click * .7 + np.sin(2 * np.pi * (1450 - 750 * t / length) * t) * .3) * np.exp(-t * 48) * strength
    for at in np.arange(.42, len(mix) / rate - .18, .51):
        start = int((at + rng.uniform(-.09, .09)) * rate)
        count = min(int(rate * .016), samples - start)
        if count > 0:
            mix[start:start + count] += rng.normal(0, .012, count) * np.linspace(1, 0, count)

    mix *= min(1.0, .94 / max(.001, np.max(np.abs(mix))))
    with tempfile.TemporaryDirectory(prefix="radio-preview-") as temporary:
        wav = Path(temporary) / "preview.wav"
        sf.write(wav, mix, rate)
        subprocess.run([helpers.ffmpeg_executable(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                        "-codec:a", "libmp3lame", "-b:a", "128k", str(OUTPUT)], check=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
