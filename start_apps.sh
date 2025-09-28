#!/bin/bash
# Start Streamlit in background
streamlit run /home/ardi/think_tank/stl.py --server.port 8502 --server.address 0.0.0.0 &
STREAMLIT_PID=$!

# Start Flask app via Gunicorn in foreground
exec /home/ardi/think_tank/venv/bin/gunicorn -b 0.0.0.0:6000 app:app &

GUNICORN_PID=$!

# Wait for both processes
wait $STREAMLIT_PID $GUNICORN_PID
