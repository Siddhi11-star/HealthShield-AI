import mysql.connector
from dotenv import load_dotenv
import os

load_dotenv()

DB_HOST     = os.getenv("DB_HOST", "localhost")
DB_USER     = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "HitarthSaparia")
DB_NAME     = os.getenv("DB_NAME", "mediguard")

print(f"Connecting to DB as user: '{DB_USER}' to database: '{DB_NAME}'")

def get_db():
    conn = mysql.connector.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME
    )
    return conn