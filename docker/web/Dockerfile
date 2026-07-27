# Next.js im standalone-Modus.
#
# Drei Stufen, damit im Endbild weder Quelltext noch Build-Werkzeuge liegen:
# ein Bild, das `npm ci` mit Dev-Dependencies enthält, ist ein Vielfaches
# grösser und bringt Angriffsfläche mit, die zur Laufzeit niemand braucht.

# ── Abhängigkeiten ───────────────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /repo

# Nur die Manifeste kopieren: solange sie sich nicht ändern, bleibt diese
# Schicht im Cache und `npm ci` läuft nicht erneut.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /repo
# npm workspaces hebt alles nach oben: es gibt kein apps/web/node_modules, das
# man kopieren könnte. Der erste Entwurf versuchte es und brach beim Bauen ab.
COPY --from=deps /repo/node_modules ./node_modules
COPY . .

# @nlm/shared wird über sein exports-Feld aus dist/ geladen; ohne diesen
# Schritt bricht der Build beim ersten Import ab.
RUN npm run build --workspace=@nlm/shared

# Die Umgebungsvariablen mit NEXT_PUBLIC_-Präfix landen zur Build-Zeit im
# Browser-Bundle. Sie müssen deshalb hier bekannt sein — anders als alle
# anderen, die erst beim Start gelesen werden.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1

RUN npx next build apps/web

# ── Laufzeit ─────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Nicht als root. Der Prozess nimmt Anfragen aus dem Netz entgegen; ein
# Ausbruch soll nicht als Systembenutzer enden.
RUN useradd --create-home --uid 10001 nextjs

# Der standalone-Build enthält den Server und genau die Module, die er braucht —
# aber weder die statischen Dateien noch public/. Beide müssen von Hand daneben
# gelegt werden; ohne sie lädt die Seite ohne Stile und ohne Bilder, und zwar
# ohne Fehlermeldung.
COPY --from=build --chown=nextjs:nextjs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nextjs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
