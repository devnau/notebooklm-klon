# 0007 · TypeScript 5.9 statt 7.x

**Status:** vorläufig · Phase 0

## Kontext

TypeScript 7 (der native Compiler) ist als `latest` veröffentlicht und deutlich
schneller als 5.x.

## Entscheidung

`typescript@^5.9.3`. Upgrade später.

## Begründung

`typescript-eslint@8` — die aktuelle Version — deklariert als Peer-Range
`>=4.8.4 <6.1.0`. Mit TypeScript 7 bricht `npm install` an einem echten
Konflikt ab, nicht an einer Formalität: die typbasierten Lint-Regeln greifen auf
Compiler-Interna zu.

Die Wahl steht damit zwischen schnellerem `tsc` und funktionierendem
typbasiertem Linting. Regeln wie `no-floating-promises` fangen in Route Handlers
echte Fehler, die sonst als stille Bugs durchgehen. Compile-Geschwindigkeit ist
bei dieser Codebasis kein Problem.

## Wann das neu bewertet wird

Sobald `typescript-eslint` eine Version mit TypeScript-7-Peer-Support
veröffentlicht: Version anheben, `npm run typecheck && npm run lint`, fertig.
Am Code ändert sich nichts — die Compiler-Optionen in `tsconfig.base.json` gelten
in beiden Versionen.
