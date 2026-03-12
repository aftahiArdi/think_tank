import subprocess
import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

SERVICES = ["think_tank-flask-1", "think_tank-streamlit-1"]

SENDER_EMAIL = os.environ.get("MAIL_USERNAME")
SENDER_PASSWORD = os.environ.get("MAIL_PASSWORD")
SMTP_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("MAIL_PORT", 587))


def get_down_services():
    down = []
    for service in SERVICES:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}", service],
            capture_output=True, text=True
        )
        if result.stdout.strip() != "true":
            down.append(service)
    return down


def send_alert(down_services):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "⚠️ Think Tank — Service Down"
    msg["From"] = SENDER_EMAIL
    msg["To"] = SENDER_EMAIL

    body = f"""
    <html><body>
    <h2>⚠️ Think Tank Service Alert</h2>
    <p>The following containers are not running:</p>
    <ul>{"".join(f"<li>{s}</li>" for s in down_services)}</ul>
    <p>SSH into your server and run <code>./deploy.sh</code> to restart.</p>
    </body></html>
    """
    msg.attach(MIMEText(body, "html"))

    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.send_message(msg)


if __name__ == "__main__":
    down = get_down_services()
    if down:
        send_alert(down)
        print(f"Alert sent for: {down}")
    else:
        print("All services running.")
