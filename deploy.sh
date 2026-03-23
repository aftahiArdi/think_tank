#!/bin/bash
set -e

cd /home/ardi/think_tank

echo "Building API image..."
docker build -t think_tank_api -f Dockerfile.api .

echo "Building frontend image..."
docker build -t think_tank_frontend -f frontend/Dockerfile frontend/

echo "Restarting containers..."
docker compose up -d --force-recreate

echo "Done. Status:"
docker compose ps
