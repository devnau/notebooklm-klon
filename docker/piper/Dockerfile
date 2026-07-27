# Piper mit einer schlanken HTTP-Hülle.
#
# Warum nicht ein fertiges Image: die verbreiteten Piper-Container sprechen
# Wyoming über TCP, nicht HTTP. Der Worker müsste dann zwei Protokolle können —
# eines für Piper, eines für Kokoro. Mit dieser Hülle sprechen beide HTTP, und
# der TTS-Adapter unterscheidet nur noch die Adresse.
FROM python:3.12-slim

# espeak-ng liefert die Phonemisierung; ohne sie startet Piper nicht.
RUN apt-get update \
 && apt-get install --no-install-recommends -y espeak-ng \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir piper-tts==1.3.0 flask==3.1.0 waitress==3.0.2

COPY server.py /app/server.py

ENV PIPER_VOICE_DIR=/voices
VOLUME ["/voices"]
EXPOSE 5000

# Kein root: der Container lädt Modelle aus dem Netz und verarbeitet Text, den
# ein Nutzer beeinflussen kann.
RUN useradd --create-home --uid 10001 piper && mkdir -p /voices && chown piper /voices
USER piper

CMD ["python", "/app/server.py"]
