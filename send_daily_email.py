# send_daily_email.py
import os
import sqlite3
from datetime import datetime
import pytz
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# -------------------- CONFIG --------------------
load_dotenv()

DB_PATH = "/home/ardi/think_tank/notes.db"
VANCOUVER_TZ = pytz.timezone("America/Vancouver")

SENDER_EMAIL = os.environ.get("MAIL_USERNAME")
SENDER_PASSWORD = os.environ.get("MAIL_PASSWORD")
RECIPIENT_EMAIL = os.environ.get("MAIL_USERNAME")
SMTP_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("MAIL_PORT", 587))


# -------------------- DB HELPERS --------------------

def get_ideas_for_date(target_date):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    date_str = target_date.strftime("%Y-%m-%d")
    cursor.execute("""
        SELECT i.content, i.timestamp, c.name as category_name, c.color as category_color
        FROM ideas i
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE DATE(i.timestamp) = ?
        ORDER BY i.timestamp
    """, (date_str,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


# -------------------- EMAIL --------------------

def send_daily_ideas_email():
    now = datetime.now(VANCOUVER_TZ)
    today = now.date()

    ideas = get_ideas_for_date(today)
    if not ideas:
        print(f"No ideas to email for {today}")
        return

    subject = f"💡 Think Tank — {today.strftime('%B %d, %Y')} ({len(ideas)} idea{'s' if len(ideas) != 1 else ''})"

    html_content = f"""
    <html>
        <body>
            <h2>💡 Ideas captured on {today.strftime('%A, %B %d, %Y')}</h2>
            <ul>
    """
    for row in ideas:
        timestamp = datetime.strptime(row['timestamp'], "%Y-%m-%d %H:%M:%S").strftime('%I:%M %p')
        category = f" <span style='background:{row['category_color']}22;color:{row['category_color']};padding:1px 6px;border-radius:99px;font-size:0.8em;'>{row['category_name']}</span>" if row['category_name'] else ""
        html_content += f"<li><strong>{timestamp}:</strong>{category} {row['content']}</li>\n"

    html_content += """
            </ul>
            <br>
            <p style="color: gray; font-size: 0.9em;">
                This is your automated daily summary from Think Tank.
            </p>
        </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SENDER_EMAIL
    msg["To"] = RECIPIENT_EMAIL
    msg.attach(MIMEText(html_content, "html"))

    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.send_message(msg)

    print(f"✅ Email sent successfully at {now.strftime('%Y-%m-%d %H:%M:%S %Z')}")


if __name__ == "__main__":
    send_daily_ideas_email()
