"""HTTP-Hülle um Piper.

Piper bringt zwar einen eigenen HTTP-Server mit, der lädt aber genau ein
Modell. Für einen Zwei-Sprecher-Dialog braucht es zwei Stimmen im selben
Prozess — sonst zwei Container pro Sprache, und der Adapter im Worker müsste
wissen, welcher Port welche Stimme hat.

Diese Hülle lädt Stimmen bei Bedarf und hält sie im Speicher. Der erste Aufruf
einer Stimme dauert deshalb länger (Download plus Laden), jeder weitere nicht.
"""

import io
import logging
import os
import threading
import wave
from pathlib import Path

from flask import Flask, Response, jsonify, request
from piper import PiperVoice
from piper.download_voices import download_voice

VOICE_DIR = Path(os.environ.get("PIPER_VOICE_DIR", "/voices"))
# Ohne Positivliste könnte ein Aufrufer beliebige Namen anfragen und der
# Container lüde wahllos Modelle aus dem Netz. Die Liste steht auch im Worker
# (lib/tts.ts) — sie ist der Vertrag zwischen beiden.
ALLOWED = {
    "de_DE-thorsten-high",
    "de_DE-kerstin-low",
    "de_DE-eva_k-x_low",
    "de_DE-ramona-low",
    "de_DE-pavoque-low",
}

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

_voices: dict[str, PiperVoice] = {}
# Laden ist nicht threadsicher und dauert; ohne Sperre lädt bei zwei
# gleichzeitigen Anfragen jeder Thread dasselbe Modell erneut.
_lock = threading.Lock()


def get_voice(name: str) -> PiperVoice:
    with _lock:
        if name not in _voices:
            model = VOICE_DIR / f"{name}.onnx"
            if not model.exists():
                app.logger.info("Lade Stimme %s ...", name)
                VOICE_DIR.mkdir(parents=True, exist_ok=True)
                download_voice(name, VOICE_DIR)
            _voices[name] = PiperVoice.load(model)
        return _voices[name]


@app.get("/health")
def health() -> Response:
    return jsonify({"status": "ok", "geladen": sorted(_voices)})


@app.get("/voices")
def voices() -> Response:
    return jsonify(sorted(ALLOWED))


@app.post("/synthesize")
def synthesize() -> Response:
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()
    voice_name = payload.get("voice") or "de_DE-thorsten-high"

    if not text:
        return jsonify({"error": "text fehlt"}), 400
    if len(text) > 5000:
        return jsonify({"error": "text zu lang"}), 413
    if voice_name not in ALLOWED:
        return jsonify({"error": f"unbekannte Stimme: {voice_name}"}), 400

    voice = get_voice(voice_name)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        voice.synthesize_wav(text, wav)

    return Response(buffer.getvalue(), mimetype="audio/wav")


if __name__ == "__main__":
    # Ein Worker, mehrere Threads: die Modelle liegen im Prozessspeicher, und
    # mehrere Prozesse würden sie mehrfach halten. Der Worker ruft ohnehin
    # sequenziell auf.
    from waitress import serve

    serve(app, host="0.0.0.0", port=5000, threads=2)
