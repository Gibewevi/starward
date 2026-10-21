"""Prepare four human French-from-France radio voice prompts from Common Voice.

The small voice-reference WAVs are local build inputs, not game assets. Source
clips are Mozilla Common Voice recordings (CC0); the repacked Parquet metadata
is from keypa/common_voice_22 (Apache-2.0). The source revision and speaker
row IDs are pinned to keep voice generation reproducible.
"""

import bisect
import hashlib
import io
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".voice-cache"))
REPO = "keypa/common_voice_22"
REVISION = "6c5c52eff0ba452a3258bf3d2591561cb7382e91"
SOURCE = "data/test-00000-of-00001.parquet"
OUTPUT = ROOT / "artifacts" / "radio-voice-references"
# Each source speaker self-identifies as male, with accent "Français de France".
# Speakers were selected for a clean signal and different voice embeddings.
VOICES = (
    ("0f6a9662c45e", (15849, 15850, 15851, 15852, 15853)),
    ("0874e7f71c35", (15167, 15168, 15169, 15170, 15171)),
    ("0c75432d68e3", (15542, 15543, 15544, 15545, 15546)),
    ("0c10ab2b69b7", (15477, 15478, 15479, 15480, 15481)),
)


def main():
    import numpy as np
    import pyarrow.parquet as pq
    import soundfile as sf
    from huggingface_hub import hf_hub_download
    from math import gcd
    from scipy.signal import resample_poly

    downloaded = Path(hf_hub_download(REPO, filename=SOURCE, revision=REVISION, repo_type="dataset"))
    parquet = pq.ParquetFile(downloaded)
    offsets = [0]
    for group in range(parquet.num_row_groups):
        offsets.append(offsets[-1] + parquet.metadata.row_group(group).num_rows)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "dataset": REPO, "revision": REVISION, "source": SOURCE,
        "recording_license": "CC0-1.0 (Mozilla Common Voice)",
        "repack_metadata_license": "Apache-2.0", "voices": [],
    }
    for voice, (speaker_prefix, indexes) in enumerate(VOICES):
        pieces = []
        origins = []
        speaker_id = None
        for index in indexes:
            group = bisect.bisect_right(offsets, index) - 1
            row = parquet.read_row_group(group, columns=["audio", "client_id", "gender", "accents", "sentence", "path"]).to_pylist()[index - offsets[group]]
            if not row["client_id"].startswith(speaker_prefix) or row["gender"] != "male_masculine" or row["accents"] != "Français de France":
                raise ValueError(f"Common Voice row {index} has changed speaker or accent")
            speaker_id = row["client_id"]
            data, rate = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            if rate != 24000:
                divisor = gcd(rate, 24000)
                data = resample_poly(data, 24000 // divisor, rate // divisor)
            # Remove only long beginning/end silence, retaining natural pauses.
            above = np.flatnonzero(np.abs(data) > .012)
            if len(above) < 24000:
                continue
            start = max(0, above[0] - 2400)
            end = min(len(data), above[-1] + 2401)
            data = data[start:end].copy()
            fade = min(240, len(data) // 8)
            data[:fade] *= np.linspace(0, 1, fade)
            data[-fade:] *= np.linspace(1, 0, fade)
            if sum(len(piece) for piece in pieces) / 24000 + len(data) / 24000 > 11.3 and len(pieces) >= 3:
                break
            pieces.extend((data, np.zeros(2400, dtype="float32")))
            origins.append({"row": index, "path": row["path"], "sentence": row["sentence"]})
            if sum(len(piece) for piece in pieces) / 24000 >= 8.0:
                break
        audio = np.concatenate(pieces).astype("float32")
        if not 6 <= len(audio) / 24000 <= 12:
            raise ValueError(f"Voice {voice}: unsuitable {len(audio) / 24000:.2f}s reference")
        rms = float(np.sqrt(np.mean(audio * audio)))
        audio *= min(3.0, .085 / max(rms, .001))
        audio = np.clip(audio, -.98, .98)
        target = OUTPUT / f"voice-{voice}.wav"
        sf.write(target, audio, 24000, subtype="PCM_16")
        manifest["voices"].append({
            "voice": voice, "speaker_id": speaker_id, "accent": "Français de France",
            "duration": round(len(audio) / 24000, 2), "clips": origins,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        })
        print(f"voice-{voice}.wav: {speaker_prefix}, {len(audio) / 24000:.2f}s, {len(origins)} prises", flush=True)
    (OUTPUT / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
