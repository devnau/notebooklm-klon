# 0005 · Piper für deutsche Sprachausgabe

**Status:** akzeptiert · Phase 0, umgesetzt in Phase 5

## Kontext

Der Audio-Überblick braucht zwei unterscheidbare Stimmen. Vorgabe war lokales
TTS im Docker, ohne Cloud-Dienst. Erste Wahl war Kokoro-82M.

## Entscheidung

Ein TTS-Adapter mit zwei Anbietern: **Piper** für deutsche Notebooks, **Kokoro**
für englische. Die Notebook-Sprache entscheidet.

## Begründung

Kokoro-82M unterstützt kein Deutsch — nur en, ja, zh, es, fr, hi, it und pt-BR.
Für eine primär deutschsprachige Anwendung wäre es damit unbrauchbar, unabhängig
von der Stimmqualität.

Piper hat mehrere brauchbare deutsche Stimmen (`de_DE-thorsten-high`,
`de_DE-kerstin-low`, `de_DE-eva_k-x_low`), läuft schnell auf CPU und braucht
keine GPU. Für englische Notebooks bleibt Kokoro, weil die Prosodie dort
merklich natürlicher ist.

Der Adapter (`worker/src/lib/tts.ts`) ist ohnehin sinnvoll: falls Stimmqualität
später wichtiger wird als Self-Hosting, kommt ein Cloud-Anbieter hinter dasselbe
Interface, ohne die Pipeline anzufassen.

## Preis dafür

Zwei Container statt einem und zwei Stimmkataloge, die auseinanderlaufen können.
Piper klingt außerdem hörbar synthetischer als ein guter Cloud-Dienst — das ist
der Preis dafür, dass die Dokumente den Server nicht verlassen.
