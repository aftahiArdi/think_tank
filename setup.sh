#!/bin/bash
set -e

echo "=== Think Tank setup ==="

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32)
  sed -i "s/^COOKIE_SECRET=$/COOKIE_SECRET=$SECRET/" .env
  echo "✓ Created .env (COOKIE_SECRET generated — add your other keys if needed)"
else
  echo "  .env already exists, skipping"
fi

# DB + uploads
touch notes.db
mkdir -p uploads
echo "✓ notes.db and uploads/ ready"

# Build + start (no Ollama by default)
echo "Building and starting containers..."
docker compose up -d --build
echo "✓ Containers running"

# Create users
echo ""
echo "Now create your users:"
docker exec -it think_tank_api python create_users.py

echo ""
echo "=== Done ==="
echo "App:  http://localhost:3004"
echo "API:  http://localhost:6000"
echo ""
echo "To enable AI daily recaps (Ollama), run:"
echo "  docker compose --profile ollama up -d"
echo "  docker exec -it think_tank_ollama ollama pull llama3.2:3b"
