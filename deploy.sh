#!/bin/bash
set -e

cd /home/ardi/Projects/think_tank

echo "Building images..."
docker compose --profile ollama build --no-cache

echo "Restarting containers..."
docker compose --profile ollama up -d --force-recreate

echo "Done. Status:"
docker compose --profile ollama ps
