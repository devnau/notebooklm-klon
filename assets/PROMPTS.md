# Asset-Prompts

Grafiken entstehen über ChatGPT. Hier steht pro Asset ein fertiger Prompt plus
die technische Spezifikation. Die Prompts liegen im Repo, damit sie versioniert
und reproduzierbar sind — ein später nachgeneriertes Asset sieht dann wie die
übrigen aus.

## Ablauf

1. **Stil-Präambel** unten kopieren.
2. Den Asset-Prompt anhängen.
3. Bei ChatGPT generieren, gegebenenfalls nachschärfen.
4. Datei unter dem angegebenen Pfad ablegen, mit dem angegebenen Namen.
5. Sagen, dass es liegt — Platzhalter wird ersetzt und optimiert (WebP/AVIF,
   `next/image`, Dark-Mode-Variante wo nötig).

Die UI wird immer zuerst mit einem neutralen Platzhalter derselben Maße gebaut.
Es wartet also nichts auf ein Asset.

**Namen exakt übernehmen.** Der Code referenziert diese Pfade.

---

## Stil-Präambel

Diese Absätze **jedem** Prompt voranstellen:

> Du erstellst ein Asset für „Notebook Studio", eine Web-Anwendung zum Arbeiten
> mit eigenen Dokumenten: hochladen, durchsuchen, belegte Antworten erhalten.
> Ruhig und werkzeugartig, nicht spielerisch, nicht nach Start-up-Marketing.
>
> Farbpalette, verbindlich:
>
> - Warmes Papierweiß `#FAF9F6` als heller Grund
> - Tiefes warmes Anthrazit `#1E1D1A` als dunkler Grund
> - Petrol `#0F6E7A` als Hauptakzent
> - Bernstein `#C97A2B` als Sekundärakzent, sparsam
> - Warme Graustufen für alles dazwischen, keine kühlen Blaugraus
>
> Stil: reduzierte geometrische Illustration mit gleichmäßiger Linienstärke von
> etwa 2 Pixel bei 800 Pixel Breite. Flächen sind flach oder haben höchstens
> einen dezenten Verlauf innerhalb eines Farbtons. Keine Schlagschatten, keine
> 3D-Effekte, keine Glasmorphismus-Optik, keine Verläufe über mehrere Farbtöne.
>
> Ausdrücklich vermeiden: violette Farbverläufe, Neon, Hochglanz, generische
> KI-Ästhetik, Roboter, Gehirne, Glühbirnen, schwebende Chatblasen, gestapelte
> Karten in Isometrie. Keine Menschen mit Gesichtern. Kein Text im Bild, außer
> es ist ausdrücklich gefordert.
>
> Motive dürfen abstrakt bleiben. Ein Dokument darf als Rechteck mit
> angedeuteten Textlinien erscheinen, es braucht keine lesbaren Inhalte.

---

## Phase 1

### 1. Wortmarke und Icon

|         |                                                                                      |
| ------- | ------------------------------------------------------------------------------------ |
| Dateien | `apps/web/public/brand/logo-wordmark.svg`, `logo-wordmark-dark.svg`, `logo-icon.svg` |
| Format  | SVG, Vektor, transparenter Hintergrund                                               |
| Maße    | Wortmarke etwa 160 × 32, Icon quadratisch 64 × 64                                    |

**Prompt:**

> Entwirf eine Wortmarke für „Notebook Studio" sowie ein dazu passendes
> Icon-Zeichen.
>
> Das Icon ist eine abstrakte Marke, kein Piktogramm eines Notizbuchs: eine
> geometrische Form, die das Prinzip „Aussage verweist zurück auf ihre Quelle"
> andeutet. Denkbar: zwei versetzte Rechtecke, die eine feine Linie verbindet;
> oder eine offene eckige Klammer, aus der eine Linie zu einem Punkt führt.
> Petrol `#0F6E7A` als Volltonfarbe, optisch ausgewogen in einem quadratischen
> Rahmen, erkennbar auch bei 24 Pixel.
>
> Die Wortmarke setzt „Notebook Studio" in einer geometrischen Sans mit
> mittlerer Strichstärke, ruhige Laufweite, „Notebook" halbfett und „Studio"
> normal. Icon links, Wortmarke rechts, Abstand etwa die halbe Höhe des Icons.
>
> Liefere drei Varianten: (a) für hellen Grund, Schrift in `#1E1D1A`, (b) für
> dunklen Grund, Schrift in `#FAF9F6`, Icon in `#3EA5B0`, (c) das Icon allein.

### 2. Favicon

|         |                                                                                   |
| ------- | --------------------------------------------------------------------------------- |
| Dateien | `apps/web/public/favicon.ico`, `icon-512.png`, `apple-touch-icon.png` (180 × 180) |
| Format  | PNG-Master 512 × 512, daraus abgeleitet                                           |

**Prompt:**

> Erstelle das Icon-Zeichen aus Asset 1 als quadratisches App-Icon, 512 × 512.
> Hintergrund vollflächig Petrol `#0F6E7A`, Zeichen in warmem Papierweiß
> `#FAF9F6`. Das Zeichen füllt etwa 60 Prozent der Fläche und ist optisch
> zentriert; ringsum bleibt gleichmäßig Luft, damit ein Maskable-Icon nichts
> abschneidet. Keine Ecken abrunden, das übernimmt das Betriebssystem. Bei
> 16 Pixel muss es noch als Form erkennbar sein — also keine Linien unter
> 12 Pixel Stärke bei dieser Größe.

### 3. Leerer Zustand: kein Notebook

|       |                                                     |
| ----- | --------------------------------------------------- |
| Datei | `apps/web/public/illustrations/empty-notebooks.png` |
| Maße  | 800 × 600, transparenter Hintergrund                |

**Prompt:**

> Illustration für den Zustand „noch kein Notebook angelegt".
>
> Zeige drei bis vier leere, leicht überlappende Rechtecke in gleichmäßiger
> Linienstärke, wie Karten in einer Ablage. Sie sind bewusst leer — keine
> Textlinien darin. Eines liegt etwas herausgezogen vor den anderen und ist mit
> Petrol `#0F6E7A` konturiert, die übrigen in warmem Grau. Links unten deutet
> eine feine Linie eine Ablagefläche an.
>
> Die Komposition ist ruhig und einladend, nicht traurig oder leer im negativen
> Sinn: es soll aussehen wie ein aufgeräumter Schreibtisch vor dem Anfang, nicht
> wie ein verlassener. Reichlich Weißraum. Transparenter Hintergrund.

### 4. Hintergrund für die Anmeldeseite

|       |                                                           |
| ----- | --------------------------------------------------------- |
| Datei | `apps/web/public/backgrounds/auth.png`                    |
| Maße  | 2000 × 1200, wird beschnitten — kein Motiv an den Rändern |

**Prompt:**

> Abstrakter, sehr zurückhaltender Hintergrund für eine Anmeldeseite.
>
> Grundfläche warmes Papierweiß `#FAF9F6`. Darüber ein großzügiges, weit
> auseinander liegendes Netz feiner Linien in warmem Grau bei etwa 8 Prozent
> Deckkraft — angedeutete Verbindungen zwischen wenigen Punkten, wie eine sehr
> spärliche Karte. Zwei oder drei Knotenpunkte sind in Petrol `#0F6E7A` bei
> etwa 20 Prozent Deckkraft hervorgehoben.
>
> Wichtig: extrem dezent. Über der linken Bildhälfte liegt später ein
> Anmeldeformular, dort muss Text gut lesbar bleiben. Nichts Kontrastreiches in
> der Bildmitte, kein Motiv in den äußeren 10 Prozent. Keine Farbverläufe über
> die ganze Fläche.

---

## Später

Diese Assets werden in ihrer jeweiligen Phase mit vollständigem Prompt ergänzt:

| Asset                         | Datei                                          | Maße        | Phase |
| ----------------------------- | ---------------------------------------------- | ----------- | ----- |
| Leerer Zustand: keine Quellen | `illustrations/empty-sources.png`              | 800 × 600   | 2     |
| Leerer Zustand: keine Notizen | `illustrations/empty-notes.png`                | 800 × 600   | 4     |
| Audio-Cover                   | `illustrations/audio-cover.png`                | 1200 × 1200 | 5     |
| Fehlerseiten 404 und 500      | `illustrations/error-404.png`, `error-500.png` | 800 × 600   | 7     |
| Social-Preview                | `og-image.png`                                 | 1200 × 630  | 7     |
| README-Hero                   | `docs/images/hero.png`                         | Screenshot  | 7     |

---

## Was nicht generiert wird

**Funktionale Icons** kommen aus [Lucide](https://lucide.dev) — Dateitypen,
Schaltflächen, Statusanzeigen. Generierte Icon-Sets sind selten pixelgenau
konsistent, skalieren schlecht und lassen sich nicht einfärben.

**Der README-Hero** ist ein echter Screenshot der laufenden App. Ein generiertes
Bild einer Oberfläche, die es nicht gibt, wäre irreführend.

## Nach dem Ablegen

Sicherheitshinweis, damit ihn später niemand für einen Bug hält: der
Upload-Guard weist **von Nutzern hochgeladene** SVGs ab, weil SVG ausführbares
Markup ist und damit ein XSS-Vektor. Eigene Asset-SVGs unter `public/` sind davon
nicht betroffen — sie gehen nie durch diesen Pfad. Siehe
[docs/security.md](../docs/security.md).
