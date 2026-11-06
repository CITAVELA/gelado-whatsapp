#!/usr/bin/env bash
# Regenera los audios de prueba (1,5 s, un tono de 440 Hz con vibrato; unos pocos KB cada uno) que imitan lo que graba
# MediaRecorder en cada navegador. Uso: bash apps/api/test/fixtures/audio/generar-audio.sh   (necesita ffmpeg)
set -euo pipefail
cd "$(dirname "$0")"
FF="${FFMPEG:-ffmpeg}"
SRC=(-f lavfi -i "sine=frequency=440:duration=1.5,vibrato=f=5:d=0.4,volume=0.5")
q=(-hide_banner -loglevel error -y)

# Chrome / Edge / Android: audio/webm;codecs=opus (Opus 48 kHz estéreo en Matroska/WebM)
"$FF" "${q[@]}" "${SRC[@]}" -ac 2 -ar 48000 -c:a libopus -b:a 24k -f webm voz-chrome.webm
# Firefox: audio/ogg;codecs=opus (Opus 48 kHz mono en Ogg)
"$FF" "${q[@]}" "${SRC[@]}" -ac 1 -ar 48000 -c:a libopus -b:a 24k -f ogg voz-firefox.ogg
# Safari macOS: audio/mp4 (AAC-LC 44,1 kHz mono, MP4 fragmentado como el que entrega MediaRecorder)
"$FF" "${q[@]}" "${SRC[@]}" -ac 1 -ar 44100 -c:a aac -b:a 32k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 voz-safari.mp4
# Safari iOS: audio/mp4 (AAC-LC 48 kHz estéreo, MP4 normal con el índice al principio)
"$FF" "${q[@]}" "${SRC[@]}" -ac 2 -ar 48000 -c:a aac -b:a 48k -movflags +faststart -f mp4 voz-ios.m4a
ls -l
