import pandas as pd
import mysql.connector
from dotenv import load_dotenv
import os

load_dotenv()

# Connect to database
db = mysql.connector.connect(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", ""),
    database=os.getenv("DB_NAME", "mediguard")
)
cursor = db.cursor()

# Read the CSV file
print("Reading CSV file...")
df = pd.read_csv("medicine_details.csv")

# Drop rows where product_name is empty or NaN
df = df.dropna(subset=["product_name"])
df = df[df["product_name"].str.strip() != ""]

print(f"Total valid medicines in CSV: {len(df)}")

# Clear existing medicines first
cursor.execute("DELETE FROM medicines")
db.commit()
print("Cleared old medicines table...")

success = 0
errors  = 0

for index, row in df.iterrows():
    try:
        name         = str(row.get("product_name",        "")).strip()[:150]
        category     = str(row.get("sub_category",        "General")).strip()[:100]
        strength     = str(row.get("salt_composition",    "")).strip()[:50]
        manufacturer = str(row.get("product_manufactured","")).strip()[:150]
        description  = str(row.get("medicine_desc",       "")).strip()
        side_effects = str(row.get("side_effects",        "")).strip()
        dosage_form  = "Tablet"

        # Skip if name is empty
        if not name or name.lower() == "nan":
            continue

        cursor.execute("""
            INSERT INTO medicines
            (name, category, dosage_form, strength, side_effects, description, manufacturer, quantity, min_stock_level)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (name, category, dosage_form, strength, side_effects,
              description, manufacturer, 100, 10))

        success += 1

        if success % 500 == 0:
            print(f"Imported {success} medicines so far...")

    except Exception as e:
        errors += 1

db.commit()
db.close()

print(f"\nDone!")
print(f"Successfully imported : {success} medicines")
print(f"Errors skipped        : {errors}")