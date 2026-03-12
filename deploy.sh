#!/bin/bash
set -e

cd /home/ardi/think_tank

echo "Building image..."
docker build -t think_tank .

echo "Restarting containers..."
docker compose up -d --force-recreate

echo "Done. Status:"
docker compose ps
