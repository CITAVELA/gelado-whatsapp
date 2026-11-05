#!/bin/bash
# gelado-whatsapp · preparación de cada sesión en la nube (hook SessionStart).
# Solo actúa con CLAUDE_CODE_REMOTE=true; en local no hace nada.
# rsc-harness no viaja en git (.rsc/ está en .gitignore), así que en un clon nuevo se reconstruye
# con la versión fijada, que recoge del .rsc.json los skills, agentes y opt-outs del proyecto.
# Siempre sale con 0: un fallo se avisa por stderr y deja el detalle en un registro de /tmp.
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
REGISTRO="${TMPDIR:-/tmp}/gelado-rsc-sync.log"

if [ -f .rsc.json ] && [ ! -f .rsc/.version ]; then
  npx -y @ericrisco/rsc@3.7.5 sync >"$REGISTRO" 2>&1 \
    || echo "gelado-whatsapp: rsc sync falló; detalle en $REGISTRO" >&2
fi
exit 0
