#!/usr/bin/env bash
# Script de configuración del entorno en la nube de Claude Code.
# Deja listo Node + pnpm + PostgreSQL local para desarrollar y probar sin servicios externos.
set -euo pipefail

as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then su postgres -c "$(printf '%q ' "$@")"; else sudo -u postgres "$@"; fi
}

# pnpm vía corepack
corepack enable >/dev/null 2>&1 || npm install -g pnpm
pnpm --version

# PostgreSQL local
if ! command -v psql >/dev/null 2>&1; then
  as_root apt-get update -y
  as_root apt-get install -y postgresql postgresql-contrib
fi
as_root service postgresql start >/dev/null 2>&1 || true

# Usuario, base de datos y esquema de desarrollo (idempotente)
as_postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='gelado'" | grep -q 1 || \
  as_postgres psql -c "CREATE ROLE gelado LOGIN PASSWORD 'gelado' SUPERUSER;"
as_postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='gelado'" | grep -q 1 || \
  as_postgres psql -c "CREATE DATABASE gelado OWNER gelado;"
as_postgres psql -d gelado -c "CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION gelado;"

# ffmpeg para convertir notas de voz (respaldo si ffmpeg-static no sirve)
command -v ffmpeg >/dev/null 2>&1 || as_root apt-get install -y ffmpeg || true

[ -f .env ] || cp .env.example .env
echo "Entorno listo."
