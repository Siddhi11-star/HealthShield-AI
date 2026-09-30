import pandas as pd
import mysql.connector
from dotenv import load_dotenv
import os
import json
import re

load_dotenv()

db = mysql.connector.connect(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", "HitarthSaparia"),
    database=os.getenv("DB_NAME", "mediguard")
)
cursor = db.cursor()

print("Reading CSV file...")
df = pd.read_csv("medicine_details.csv")
df = df.dropna(subset=["product_name", "drug_interactions"])
df = df[df["drug_interactions"].str.strip() != ""]
print(f"Rows with interaction data: {len(df)}")

cursor.execute("DELETE FROM drug_interactions")
db.commit()
print("Cleared old interactions...")

success = 0
errors  = 0
seen    = set()

for index, row in df.iterrows():
    try:
        medicine_name = str(row["product_name"]).strip()
        raw           = str(row["drug_interactions"]).strip()

        if not raw or raw.lower() == "nan":
            continue

        # Fix single quotes to double quotes for JSON parsing
        raw_fixed = raw.replace("'", '"')

        try:
            data  = json.loads(raw_fixed)
            drugs = data.get("drug", [])
        except Exception:
            # Try extracting drug names with regex if JSON fails
            drugs = re.findall(r'"([^"]+)"', raw)

        for other_drug in drugs:
            other_drug = str(other_drug).strip()
            if not other_drug or len(other_drug) < 2:
                continue

            # Avoid duplicate pairs
            pair = tuple(sorted([medicine_name.lower(), other_drug.lower()]))
            if pair in seen:
                continue
            seen.add(pair)

            cursor.execute("""
                INSERT INTO drug_interactions (drug_a, drug_b, effect, severity)
                VALUES (%s, %s, %s, %s)
            """, (
                medicine_name,
                other_drug,
                "Potential interaction — monitor closely or consult doctor",
                "moderate"
            ))
            success += 1

        if success % 1000 == 0 and success > 0:
            db.commit()
            print(f"Imported {success} interactions so far...")

    except Exception as e:
        errors += 1

db.commit()
db.close()

print(f"\nDone!")
print(f"Successfully imported : {success} interactions")
print(f"Errors skipped        : {errors}")
import pandas as pd
import mysql.connector
from dotenv import load_dotenv
import os
import json
import re

load_dotenv()

db = mysql.connector.connect(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", "HitarthSaparia"),
    database=os.getenv("DB_NAME", "mediguard")
)
cursor = db.cursor()

print("Reading CSV file...")
df = pd.read_csv("medicine_details.csv")
df = df.dropna(subset=["product_name", "drug_interactions"])
df = df[df["drug_interactions"].str.strip() != ""]
print(f"Rows with interaction data: {len(df)}")

cursor.execute("DELETE FROM drug_interactions")
db.commit()
print("Cleared old interactions...")

success = 0
errors  = 0
seen    = set()

for index, row in df.iterrows():
    try:
        medicine_name = str(row["product_name"]).strip()
        raw           = str(row["drug_interactions"]).strip()

        if not raw or raw.lower() == "nan":
            continue

        # Fix single quotes to double quotes for JSON parsing
        raw_fixed = raw.replace("'", '"')

        try:
            data  = json.loads(raw_fixed)
            drugs = data.get("drug", [])
        except Exception:
            # Try extracting drug names with regex if JSON fails
            drugs = re.findall(r'"([^"]+)"', raw)

        for other_drug in drugs:
            other_drug = str(other_drug).strip()
            if not other_drug or len(other_drug) < 2:
                continue

            # Avoid duplicate pairs
            pair = tuple(sorted([medicine_name.lower(), other_drug.lower()]))
            if pair in seen:
                continue
            seen.add(pair)

            cursor.execute("""
                INSERT INTO drug_interactions (drug_a, drug_b, effect, severity)
                VALUES (%s, %s, %s, %s)
            """, (
                medicine_name,
                other_drug,
                "Potential interaction — monitor closely or consult doctor",
                "moderate"
            ))
            success += 1

        if success % 1000 == 0 and success > 0:
            db.commit()
            print(f"Imported {success} interactions so far...")

    except Exception as e:
        errors += 1

db.commit()
db.close()

print(f"\nDone!")
print(f"Successfully imported : {success} interactions")
print(f"Errors skipped        : {errors}")
