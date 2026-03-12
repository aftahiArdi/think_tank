# Think Tank — Maintenance Guide

## Updating the App (after any code change)

1. Rebuild the image from the project directory:
   ```bash
   cd /home/ardi/think_tank
   docker build -t think_tank .
   ```

2. In Portainer → **Stacks** → `think_tank` → **Update the stack**

That's it. The new image is picked up and containers restart automatically.

---

## Daily Email (send_daily_email.py)

The email script runs outside Docker via cron. To set it up:

```bash
crontab -e
```

Add this line to send at 8am Vancouver time:
```
0 8 * * * docker exec think_tank-flask-1 python /app/send_daily_email.py
```

To test it manually:
```bash
docker exec think_tank-flask-1 python /app/send_daily_email.py
```

---

## Categorizing Ideas (categorize_ideas.py)

This runs outside Docker using the venv — it's too heavy for the container.

```bash
cd /home/ardi/think_tank
source venv/bin/activate
python categorize_ideas.py
```

---

## Checking Logs

Via Portainer: **Stacks** → `think_tank` → click a service → **Logs**

Via terminal:
```bash
docker compose logs -f flask
docker compose logs -f streamlit
```

---

## Restarting Services

Via Portainer: **Stacks** → `think_tank` → **Stop** then **Start**

Via terminal:
```bash
cd /home/ardi/think_tank
docker compose restart
```

---

## Backing Up the Database

```bash
cp /home/ardi/think_tank/notes.db /home/ardi/think_tank/notes.db.bak

# The DB is mounted into containers at /app/notes.db via absolute path:
# /home/ardi/think_tank/notes.db:/app/notes.db
```

The DB is a plain file on the host — no special Docker steps needed.

---

## If the Image Gets Stale / Something Breaks

Full clean rebuild:
```bash
cd /home/ardi/think_tank
docker build --no-cache -t think_tank .
```

Then update the stack in Portainer.

---

## Ports

| Service    | Port |
|------------|------|
| Streamlit  | 8502 |
| Flask API  | 6000 |
| Portainer  | 9000 |
