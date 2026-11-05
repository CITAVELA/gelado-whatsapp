#!/usr/bin/env bash
# Arranca PostgreSQL local: Docker si hay daemon; si no, el servicio del sistema (entorno en la nube).
set -euo pipefail
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d db
else
  (service postgresql start || sudo service postgresql start) >/dev/null 2>&1 || true
  pg_isready -h localhost -p 5432 && echo "PostgreSQL del sistema listo"
fi
