"""Build temporary, traceable native-French voice candidates for audition."""

import io
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from scipy.signal import resample_poly


ROOT = Path(__file__).resolve().parents[1]
PARQUET = next((ROOT / ".voice-cache" / "hub" / "datasets--keypa--common_voice_22" / "snapshots").glob("*/data/test-00000-of-00001.parquet"))
OUT = ROOT / "artifacts" / "radio-native-candidates"
PREFIXES = (
    "0874e7f71c35", "0f6a9662c45e", "2eb7aaf2b2df", "796f66f11f15",
    "0c10ab2b69b7", "08e9ce859631", "0adaf2296641", "0c75432d68e3",
    "028983d39ef7", "0e0788065186", "0b20232dc77a", "0dcc5c9ca0c9",
)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    file = pq.ParquetFile(PARQUET)
    metadata = file.read(columns=["client_id", "sentence", "gender", "age", "accents", "up_votes", "down_votes"]).to_pylist()
    speakers = defaultdict(list)
    for index, row in enumerate(metadata):
        if row["gender"] == "male_masculine" and "France" in str(row["accents"]):
            speakers[row["client_id"]].append(index)
    result = []
    for prefix in PREFIXES:
        matches = [(id_, indexes) for id_, indexes in speakers.items() if id_.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError(f"Speaker {prefix}: {len(matches)} matches")
        id_, indexes = matches[0]
        pieces = []
        used = []
        for index in indexes:
            row = file.read_row_group(index // 100, columns=["audio"]).to_pylist()[index % 100]
            data, rate = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            if rate != 24000:
                from math import gcd
                divisor = gcd(rate, 24000)
                data = resample_poly(data, 24000 // divisor, rate // divisor)
            if len(data) / 24000 < 1.4 or np.sqrt(np.mean(data * data)) < .008:
                print("REJECT", prefix, index, round(len(data) / 24000, 2), round(float(np.sqrt(np.mean(data * data))), 4))
                continue
            # Short fades remove edit clicks while retaining the original cadence.
            fade = min(240, len(data) // 8)
            data[:fade] *= np.linspace(0, 1, fade)
            data[-fade:] *= np.linspace(1, 0, fade)
            pieces.extend((data, np.zeros(2400, dtype="float32")))
            used.append({"row": index, "text": metadata[index]["sentence"], "duration": round(len(data) / 24000, 2)})
            if sum(len(p) for p in pieces) / 24000 >= 9:
                break
        if not pieces:
            print("SKIP", prefix, "no suitable clips")
            continue
        audio = np.concatenate(pieces).astype("float32")
        if len(audio) / 24000 < 6:
            print("SKIP", prefix, round(len(audio) / 24000, 2))
            continue
        audio = audio[:int(11.8 * 24000)]
        rms = np.sqrt(np.mean(audio * audio))
        audio *= min(2, .085 / rms)
        audio = np.clip(audio, -.98, .98)
        path = OUT / f"{prefix}.wav"
        sf.write(path, audio, 24000, subtype="PCM_16")
        info = {"speaker": id_, "prefix": prefix, "age": metadata[indexes[0]]["age"], "accent": metadata[indexes[0]]["accents"], "duration": round(len(audio) / 24000, 2), "rms": round(float(np.sqrt(np.mean(audio * audio))), 3), "peak": round(float(np.max(np.abs(audio))), 3), "clips": used}
        result.append(info)
        print(prefix, info["age"], info["duration"], info["rms"], info["peak"], "|", ",".join(str(c["row"]) for c in used))
    (OUT / "candidates.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
