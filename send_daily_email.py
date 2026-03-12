# send_daily_email.py
import os
import sqlite3
import pandas as pd
from datetime import datetime
import pytz
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# -------------------- CONFIG --------------------
load_dotenv()  # load .env file

DB_PATH = "/home/ardi/think_tank/notes.db"
VANCOUVER_TZ = pytz.timezone("America/Vancouver")

# Email settings (from your .env file)
SENDER_EMAIL = os.environ.get("MAIL_USERNAME")
SENDER_PASSWORD = os.environ.get("MAIL_PASSWORD")
RECIPIENT_EMAIL = os.environ.get("MAIL_USERNAME")  # change if you want to send to another address
SMTP_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("MAIL_PORT", 587))


# -------------------- DB HELPERS --------------------



def get_ideas_for_date(target_date):
    conn = sqlite3.connect(DB_PATH)
    date_str = target_date.strftime("%Y-%m-%d")
    query = f"""
        SELECT content, timestamp FROM ideas
        WHERE DATE(timestamp) = '{date_str}'
        ORDER BY timestamp
    """
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df

SIZE_WEIGHT = {'project': 4, 'big': 3, 'small': 2, 'tiny': 1}
SIZE_LABEL = {'tiny': '🔹 Tiny', 'small': '🟦 Small', 'big': '🟧 Big', 'project': '🗂 Project'}

def get_focus_todos():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT content, size, timestamp FROM todo", conn)
    conn.close()

    if df.empty:
        return df

    now = datetime.now(VANCOUVER_TZ)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["days_old"] = df["timestamp"].apply(
        lambda t: (now - t.replace(tzinfo=VANCOUVER_TZ)).days
    )
    df["size_weight"] = df["size"].map(SIZE_WEIGHT).fillna(2)
    df = df.sort_values(by=["days_old", "size_weight"], ascending=False)
    return df.head(5)

# -------------------- EMAIL --------------------
def send_daily_ideas_email():
    now = datetime.now(VANCOUVER_TZ)
    today = now.date()

    ideas_df = get_ideas_for_date(today)
    todos_df = get_focus_todos()
    if ideas_df.empty and todos_df.empty:
        print(f"No ideas or todos to email for {today}")
        return

    subject = f"Your Focus for Today — {today.strftime('%B %d, %Y')}"

    html_content = f"""
    <html>
        <body>
            <h2>🎯 Your Focus for {today.strftime('%A, %B %d, %Y')}</h2>
    """

    if not todos_df.empty:
        html_content += """
            <h3>✅ Top 5 Tasks</h3>
            <ul>
        """
        for _, row in todos_df.iterrows():
            size = row.get('size') or 'small'
            size_label = SIZE_LABEL.get(size, size)
            days_old = int(row.get('days_old', 0))
            age = f"{days_old}d old" if days_old > 0 else "added today"
            html_content += (
                f"<li><strong>{row['content']}</strong> "
                f"<span style='color:gray;'>({size_label} · {age})</span></li>\n"
            )
        html_content += "</ul>"
    else:
        html_content += "<p><em>No open tasks. You're clear!</em></p>"

    if not ideas_df.empty:
        html_content += f"""
            <h3>💡 Ideas captured today ({len(ideas_df)})</h3>
            <ul>
        """
        for _, row in ideas_df.iterrows():
            timestamp = pd.to_datetime(row['timestamp']).strftime('%I:%M %p')
            html_content += f"<li><strong>{timestamp}:</strong> {row['content']}</li>\n"
        html_content += "</ul>"
    else:
        html_content += "<p><em>No ideas captured today.</em></p>"

    html_content += """
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
