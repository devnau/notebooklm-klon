# Der Job-Worker.
#
# Anders als beim Web-Bild wird hier kein Bundle gebaut: der Worker läuft über
# tsx direkt auf den TypeScript-Quellen. Das spart eine Build-Stufe, und die
# Startzeit spielt bei einem langlaufenden Prozess keine Rolle.

FROM node:24-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm ci

FROM node:24-slim AS runtime
WORKDIR /repo

# ffmpeg und ffprobe für den Audio-Überblick. Ohne sie scheitert jeder
# render_audio-Job mit „spawn ffmpeg ENOENT" — und zwar erst zur Laufzeit,
# nicht beim Start.
RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=deps /repo/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

# @nlm/shared wird über dist/ geladen.
RUN npm run build --workspace=@nlm/shared

RUN useradd --create-home --uid 10002 worker && chown -R worker /repo
USER worker

# Kein Healthcheck über einen Port: der Worker hört auf keinem. Dass er lebt,
# steht in jobs.locked_at — ein Job, der zu lange läuft, wird von
# requeue_stale_jobs() eingesammelt, und der Backlog steht in /api/health.
# Ein erfundener Endpunkt nur für Docker wäre eine zweite Wahrheit.

WORKDIR /repo/apps/worker
CMD ["npx", "tsx", "src/index.ts"]
