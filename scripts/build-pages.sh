#!/bin/sh
# Baut den Ordner für GitHub Pages: nur Dateien, die der Browser zur Laufzeit braucht.
# Tests, api/, lib/, Konfiguration und Doku bleiben draußen.
# Aufruf: scripts/build-pages.sh [Zielordner]   (Standard: _site)
set -eu
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
# Erlaubnisliste: die einzige Stelle, die festlegt, was veröffentlicht wird
FILES="index.html host.html player.html editor.html"
DIRS="css js fonts vendor"
rm -rf "$OUT"
mkdir -p "$OUT"
for f in $FILES; do cp "$f" "$OUT/$f"; done
for d in $DIRS; do cp -R "$d" "$OUT/$d"; done
echo "Pages-Ordner gebaut: $OUT"
