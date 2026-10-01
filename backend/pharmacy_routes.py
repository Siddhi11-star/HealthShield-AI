"""
PHARMACY MANAGEMENT SYSTEM - REFACTORED
=========================================

CLEARLY SEPARATED MODULES:
1. PHARMACY FINDER (PUBLIC, READ-ONLY) - /pharmacy-finder/*
2. LIVE INVENTORY (PRIVATE, PHARMACIST-ONLY) - /live-inventory/* or /my-pharmacy/*

This ensures no mixing of concerns.
"""

import os
import requests
from flask import request, jsonify
from config import get_db
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": "MediGuardAI/1.0 (OpenStreetMap pharmacy search)",
    "Accept-Language": "en"
}

def register_pharmacy_routes(app):
    from app import get_token_user
    
    # ════════════════════════════════════════════════════════════════════════════════════
    # MODULE 1: PHARMACY FINDER (PUBLIC, READ-ONLY)
    # ════════════════════════════════════════════════════════════════════════════════════
    # Purpose: Find pharmacies by location/medicine (NO inventory management)
    # No authentication required
    # Public access for patients/users
    
    @app.route("/api/pharmacy-finder/place-search", methods=["GET"])
    def finder_search_by_place():
        """
        [PHARMACY FINDER] Search by location using OpenStreetMap / Nominatim
        
        Query params:
        - query: location/place name (required)
        - lat/lng: optional coordinates to bias results
        
        Returns: Pharmacy details from OpenStreetMap (NO database, NO stock info)
        Access: PUBLIC - Any user
        """
        query = request.args.get("query", "").strip()
        
        if not query:
            return jsonify({
                "error": "Please provide a location query",
                "results": [],
                "source": "openstreetmap"
            }), 400

        try:
            params = {
                "q": f"pharmacy in {query}",
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 20
            }

            response = requests.get(
                NOMINATIM_URL,
                params=params,
                headers=NOMINATIM_HEADERS,
                timeout=10
            )
            response.raise_for_status()
            places = response.json() or []

            pharmacies = []
            center = None

            for place in places[:20]:
                lat = place.get("lat")
                lng = place.get("lon")
                display_name = place.get("display_name", "")
                name = (
                    place.get("name")
                    or place.get("namedetails", {}).get("name")
                    or display_name.split(",")[0]
                    or "Pharmacy"
                )

                pharmacy = {
                    "id": place.get("place_id") or place.get("osm_id"),
                    "name": name,
                    "address": display_name,
                    "latitude": float(lat) if lat is not None else None,
                    "longitude": float(lng) if lng is not None else None,
                    "rating": None,
                    "user_ratings_total": None,
                    "phone": "Not available",
                    "open_now": None,
                    "open_hours": "Hours not available",
                    "business_status": "UNKNOWN"
                }
                pharmacies.append(pharmacy)

                if not center and lat is not None and lng is not None:
                    center = {"lat": float(lat), "lng": float(lng)}

            return jsonify({
                "results": pharmacies,
                "pharmacies": pharmacies,
                "center": center,
                "total_results": len(pharmacies),
                "query": query,
                "source": "openstreetmap"
            }), 200

        except requests.exceptions.Timeout:
            return jsonify({"error": "OpenStreetMap request timed out", "results": [], "source": "openstreetmap"}), 504
        except requests.exceptions.RequestException as e:
            return jsonify({"error": f"Network error: {str(e)}", "results": [], "source": "openstreetmap"}), 503
        except Exception as e:
            return jsonify({"error": f"Server error: {str(e)}", "results": [], "source": "openstreetmap"}), 500


    @app.route("/api/pharmacy-finder/medicine-search", methods=["GET"])
    def finder_search_by_medicine():
        """
        [PHARMACY FINDER] Search pharmacies by medicine availability (DATABASE)
        
        Query params:
        - medicine: medicine name (required)
        
        Returns: List of pharmacies stocking the medicine with stock levels
        Access: PUBLIC - Any user
        
        ⚠️ READ-ONLY: Shows stock info only, NO editing allowed
        """
        medicine = request.args.get("medicine", "").strip()
        
        if not medicine:
            return jsonify({
                "error": "Please provide a medicine name",
                "pharmacies": [],
                "source": "database"
            }), 400
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            query = """
                SELECT 
                    p.id,
                    p.name,
                    p.address,
                    p.phone,
                    p.latitude,
                    p.longitude,
                    p.is_24hr,
                    p.has_delivery,
                    p.area,
                    p.rating,
                    pi.medicine_name,
                    pi.quantity,
                    m.category,
                    m.dosage_form AS form,
                    m.manufacturer
                FROM pharmacies p
                LEFT JOIN pharmacy_inventory pi ON p.id = pi.pharmacy_id
                LEFT JOIN medicines m ON LOWER(pi.medicine_name) = LOWER(m.name)
                WHERE LOWER(pi.medicine_name) LIKE LOWER(%s)
                ORDER BY pi.quantity DESC, p.name ASC
            """
            
            cursor.execute(query, (f"%{medicine}%",))
            results = cursor.fetchall()
            cursor.close()
            db.close()
            
            if not results:
                return jsonify({
                    "pharmacies": [],
                    "medicine": medicine,
                    "total_found": 0,
                    "source": "database"
                }), 200
            
            pharmacies = []
            for row in results:
                quantity = row.get("quantity") or 0
                
                if quantity == 0:
                    stock_status = "out_of_stock"
                elif quantity <= 20:
                    stock_status = "low_stock"
                else:
                    stock_status = "in_stock"
                
                pharmacy = {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "address": row.get("address"),
                    "phone": row.get("phone"),
                    "latitude": row.get("latitude"),
                    "longitude": row.get("longitude"),
                    "area": row.get("area"),
                    "rating": row.get("rating"),
                    "is_24hr": row.get("is_24hr") or 0,
                    "has_delivery": row.get("has_delivery") or 0,
                    "medicine_name": row.get("medicine_name"),
                    "quantity": quantity,
                    "stock_status": stock_status,
                    "category": row.get("category"),
                    "form": row.get("form"),
                    "manufacturer": row.get("manufacturer")
                }
                pharmacies.append(pharmacy)
            
            return jsonify({
                "pharmacies": pharmacies,
                "medicine": medicine,
                "total_found": len(pharmacies),
                "source": "database"
            }), 200
        
        except Exception as e:
            return jsonify({
                "error": f"Database error: {str(e)}",
                "pharmacies": [],
                "source": "database"
            }), 500


    @app.route("/api/pharmacy-finder/location-search", methods=["GET"])
    def finder_search_by_location():
        """
        [PHARMACY FINDER] Search pharmacies by location (DATABASE)
        
        Query Parameters:
        - location: location/area name or city (optional, BUT required if lat/lng not provided)
        - lat: latitude for radius-based search (optional, BUT required if location not provided)
        - lng: longitude for radius-based search (optional, BUT required if location not provided)
        - radius: search radius in km (default: 5) (optional)
        - is_24hr: filter 24-hour pharmacies (0 or 1) (optional)
        - has_delivery: filter delivery-enabled (0 or 1) (optional)
        - min_rating: minimum rating (0-5) (optional)
        - sort_by: 'distance', 'rating', 'name' (default: 'distance') (optional)
        - limit: max results (default: 20, max: 100) (optional)
        
        Returns: Pharmacies matching search criteria (NO stock editing available)
        Access: PUBLIC - Any user
        """
        try:
            location = request.args.get("location", "").strip()
            lat = request.args.get("lat", type=float)
            lng = request.args.get("lng", type=float)
            radius = request.args.get("radius", 5, type=float)
            is_24hr = request.args.get("is_24hr", type=int)
            has_delivery = request.args.get("has_delivery", type=int)
            min_rating = request.args.get("min_rating", type=float)
            sort_by = request.args.get("sort_by", "distance").lower()
            limit = min(int(request.args.get("limit", 20)), 100)
            
            if not location and (lat is None or lng is None):
                return jsonify({
                    "error": "Please provide either 'location' name or 'lat'/'lng' coordinates",
                    "pharmacies": [],
                    "total_count": 0,
                    "source": "database"
                }), 400
            
            if lat is not None and lng is not None and (lat < -90 or lat > 90 or lng < -180 or lng > 180):
                return jsonify({
                    "error": "Invalid coordinates",
                    "pharmacies": [],
                    "source": "database"
                }), 400
            
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            conditions = []
            params = []
            
            if location:
                conditions.append("LOWER(p.area) LIKE LOWER(%s) OR LOWER(p.city) LIKE LOWER(%s)")
                params.extend([f"%{location}%", f"%{location}%"])
            elif lat is not None and lng is not None:
                conditions.append(
                    "(6371 * acos(cos(radians(%s)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(%s)) + sin(radians(%s)) * sin(radians(p.latitude)))) <= %s"
                )
                params.extend([lat, lng, lat, radius])
            
            if is_24hr is not None:
                conditions.append("p.is_24hr = %s")
                params.append(is_24hr)
            
            if has_delivery is not None:
                conditions.append("p.has_delivery = %s")
                params.append(has_delivery)
            
            if min_rating is not None:
                conditions.append("p.rating >= %s")
                params.append(min_rating)
            
            where_clause = " AND ".join(conditions) if conditions else "1"
            
            if lat is not None and lng is not None:
                sort_clause = f"CASE WHEN 1=1 THEN (6371 * acos(cos(radians({lat})) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians({lng})) + sin(radians({lat})) * sin(radians(p.latitude)))) END ASC"
            elif sort_by == "rating":
                sort_clause = "p.rating DESC"
            elif sort_by == "name":
                sort_clause = "p.name ASC"
            else:
                sort_clause = "p.name ASC"
            
            query = f"""
                SELECT 
                    p.id,
                    p.name,
                    p.address,
                    p.area,
                    p.city,
                    p.state,
                    p.pincode,
                    p.phone,
                    p.latitude,
                    p.longitude,
                    p.open_hours,
                    p.is_24hr,
                    p.has_delivery,
                    p.rating,
                    p.license_no,
                    p.created_at
                    {',' + str(f'ROUND(6371 * acos(cos(radians({lat})) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians({lng})) + sin(radians({lat})) * sin(radians(p.latitude))), 2) as distance_km') if lat is not None and lng is not None else ''}
                FROM pharmacies p
                WHERE {where_clause}
                ORDER BY {sort_clause}
                LIMIT %s
            """
            
            params.append(limit)
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            
            count_query = f"""
                SELECT COUNT(*) as total FROM pharmacies p
                WHERE {where_clause}
            """
            count_params = params[:-1]
            cursor.execute(count_query, count_params)
            count_result = cursor.fetchone()
            total_count = count_result["total"] if count_result else 0
            
            cursor.close()
            db.close()
            
            pharmacies = []
            for row in results:
                pharmacy_data = {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "address": row.get("address"),
                    "area": row.get("area"),
                    "city": row.get("city"),
                    "state": row.get("state"),
                    "pincode": row.get("pincode"),
                    "phone": row.get("phone"),
                    "latitude": float(row.get("latitude")) if row.get("latitude") else None,
                    "longitude": float(row.get("longitude")) if row.get("longitude") else None,
                    "open_hours": row.get("open_hours"),
                    "is_24hr": bool(row.get("is_24hr")),
                    "has_delivery": bool(row.get("has_delivery")),
                    "rating": float(row.get("rating")) if row.get("rating") else None,
                    "license_no": row.get("license_no")
                }
                
                if "distance_km" in row and row["distance_km"] is not None:
                    pharmacy_data["distance_km"] = float(row["distance_km"])
                
                pharmacies.append(pharmacy_data)
            
            return jsonify({
                "success": True,
                "pharmacies": pharmacies,
                "total_count": total_count,
                "limit": limit,
                "source": "database",
                "search_params": {
                    "location": location,
                    "coordinates": {"lat": lat, "lng": lng} if lat and lng else None,
                    "radius_km": radius if (lat and lng) else None,
                    "filters": {
                        "is_24hr": is_24hr,
                        "has_delivery": has_delivery,
                        "min_rating": min_rating
                    },
                    "sort_by": sort_by
                }
            }), 200
        
        except Exception as e:
            return jsonify({
                "error": f"Search error: {str(e)}",
                "pharmacies": [],
                "total_count": 0,
                "source": "database"
            }), 500


    # ════════════════════════════════════════════════════════════════════════════════════
    # MODULE 2: LIVE INVENTORY (PRIVATE, PHARMACIST-ONLY, READ+WRITE)
    # ════════════════════════════════════════════════════════════════════════════════════
    # Purpose: Own pharmacy stock management (ONLY for logged-in pharmacists)
    # Authentication required: Must own the pharmacy
    # Private access: PHARMACIST ONLY
    
    def _ensure_default_stock_for_pharmacy(db, pharmacy_id):
        """
        Helper: Initialize default stock for a pharmacy if not already done
        Runs only once per pharmacy (checks for existing entries)
        """
        try:
            cursor = db.cursor(dictionary=True)
            
            # Check if any inventory already exists
            cursor.execute(
                "SELECT COUNT(*) as count FROM pharmacy_inventory WHERE pharmacy_id = %s",
                (pharmacy_id,)
            )
            result = cursor.fetchone()
            
            if result and result.get("count", 0) > 0:
                cursor.close()
                return False  # Already initialized
            
            # Get all medicines
            cursor.execute("SELECT name FROM medicines")
            medicines = cursor.fetchall()
            
            default_quantity = 20
            
            for med in medicines:
                medicine_name = med.get("name")
                cursor.execute(
                    """INSERT INTO pharmacy_inventory 
                       (pharmacy_id, medicine_name, quantity) 
                       VALUES (%s, %s, %s)""",
                    (pharmacy_id, medicine_name, default_quantity)
                )
            
            db.commit()
            cursor.close()
            return True  # Successfully initialized
        
        except Exception as e:
            print(f"Error initializing stock: {e}")
            return False

    def _get_or_create_pharmacy_for_owner(db, user_id):
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name FROM pharmacies WHERE owner_id = %s",
            (user_id,)
        )
        pharmacy = cursor.fetchone()
        if pharmacy:
            cursor.close()
            return pharmacy

        cursor.execute("SELECT name FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone() or {}
        owner_name = user.get("name") or "My"
        pharmacy_name = f"{owner_name}'s Pharmacy" if owner_name else "My Pharmacy"

        try:
            cursor.execute(
                "INSERT INTO pharmacies (owner_id, name, address, area, city, state, phone, open_hours, has_delivery, rating) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (user_id, pharmacy_name, None, None, 'Pune', 'Maharashtra', '', '8:00 AM – 10:00 PM', 0, 4.0)
            )
            db.commit()
            pharmacy_id = cursor.lastrowid
            cursor.execute("SELECT id, name FROM pharmacies WHERE id = %s", (pharmacy_id,))
            pharmacy = cursor.fetchone()
        except Exception as e:
            print(f"Error creating pharmacy for user {user_id}: {e}")
            pharmacy = None
        finally:
            cursor.close()
        return pharmacy


    @app.route("/api/live-inventory/my-pharmacy", methods=["GET"])
    def live_inventory_get():
        """
        [LIVE INVENTORY] Get inventory for logged-in pharmacist's pharmacy
        
        Returns: All medicines with quantities for THEIR pharmacy only
        Access: PHARMACIST ONLY (requires authentication + pharmacy ownership)
        """
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized - please log in", "inventory": []}), 401
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            # Verify user is pharmacist owner
            cursor.execute(
                "SELECT id, name FROM pharmacies WHERE owner_id = %s",
                (user_id,)
            )
            pharmacy = cursor.fetchone()
            
            if not pharmacy:
                cursor.close()
                db.close()
                return jsonify({
                    "error": "You are not registered as a pharmacy owner",
                    "inventory": []
                }), 403
            
            pharmacy_id = pharmacy["id"]
            
            # Get inventory
            query = """
                SELECT 
                    pi.id,
                    pi.pharmacy_id,
                    pi.medicine_name,
                    pi.quantity,
                    m.category,
                    m.dosage_form AS form,
                    m.manufacturer,
                    CASE 
                        WHEN pi.quantity = 0 THEN 'out_of_stock'
                        WHEN pi.quantity <= 10 THEN 'low_stock'
                        ELSE 'in_stock'
                    END as stock_status
                FROM pharmacy_inventory pi
                LEFT JOIN medicines m ON LOWER(pi.medicine_name) = LOWER(m.name)
                WHERE pi.pharmacy_id = %s
                ORDER BY pi.medicine_name ASC
            """
            
            cursor.execute(query, (pharmacy_id,))
            inventory = cursor.fetchall()
            cursor.close()
            db.close()
            
            # Normalize all stock statuses to match frontend thresholds
            for item in inventory:
                qty = item.get("quantity") or 0
                item["stock_status"] = "out_of_stock" if qty == 0 else "low_stock" if qty <= 10 else "in_stock"
            
            return jsonify({
                "inventory": inventory,
                "pharmacy_id": pharmacy_id,
                "pharmacy_name": pharmacy["name"],
                "total_items": len(inventory),
                "module": "live_inventory"
            }), 200
        
        except Exception as e:
            return jsonify({"error": f"Database error: {str(e)}", "inventory": []}), 500


    @app.route("/api/live-inventory/update-stock", methods=["POST"])
    def live_inventory_update_stock():
        """
        [LIVE INVENTORY] Update stock quantity
        
        Body: {"inventory_id": <int>, "quantity": <int>}
        Access: PHARMACIST ONLY (must own pharmacy)
        """
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        
        data = request.get_json() or {}
        inventory_id = data.get("inventory_id")
        quantity = data.get("quantity")
        
        if inventory_id is None or quantity is None:
            return jsonify({"error": "Missing inventory_id or quantity"}), 400
        
        try:
            quantity = int(quantity)
            if quantity < 0:
                return jsonify({"error": "Quantity cannot be negative"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid quantity format"}), 400
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            # Verify ownership
            cursor.execute(
                "SELECT pi.pharmacy_id FROM pharmacy_inventory pi WHERE pi.id = %s",
                (inventory_id,)
            )
            result = cursor.fetchone()
            
            if not result:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404
            
            pharmacy_id = result["pharmacy_id"]
            
            cursor.execute(
                "SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s",
                (pharmacy_id, user_id)
            )
            
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403
            
            # Update
            cursor.execute(
                "UPDATE pharmacy_inventory SET quantity = %s WHERE id = %s",
                (quantity, inventory_id)
            )
            db.commit()
            cursor.close()
            db.close()
            
            return jsonify({
                "success": True,
                "message": "Stock updated",
                "inventory_id": inventory_id,
                "new_quantity": quantity,
                "module": "live_inventory"
            }), 200
        
        except Exception as e:
            return jsonify({"error": f"Database error: {str(e)}"}), 500


    @app.route("/api/live-inventory/increase-stock", methods=["POST"])
    def live_inventory_increase_stock():
        """
        [LIVE INVENTORY] Increase stock by amount
        
        Body: {"inventory_id": <int>, "amount": <int>}
        Access: PHARMACIST ONLY
        """
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        
        data = request.get_json() or {}
        inventory_id = data.get("inventory_id")
        amount = data.get("amount", 1)
        
        if inventory_id is None:
            return jsonify({"error": "Missing inventory_id"}), 400
        
        try:
            amount = int(amount)
            if amount <= 0:
                return jsonify({"error": "Amount must be greater than 0"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid amount format"}), 400
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            cursor.execute(
                "SELECT pi.id, pi.quantity, pi.pharmacy_id FROM pharmacy_inventory pi WHERE pi.id = %s",
                (inventory_id,)
            )
            result = cursor.fetchone()
            
            if not result:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404
            
            pharmacy_id = result["pharmacy_id"]
            
            cursor.execute(
                "SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s",
                (pharmacy_id, user_id)
            )
            
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403
            
            new_quantity = (result["quantity"] or 0) + amount
            cursor.execute(
                "UPDATE pharmacy_inventory SET quantity = %s WHERE id = %s",
                (new_quantity, inventory_id)
            )
            db.commit()
            cursor.close()
            db.close()
            
            return jsonify({
                "success": True,
                "message": f"Stock increased by {amount}",
                "inventory_id": inventory_id,
                "new_quantity": new_quantity,
                "module": "live_inventory"
            }), 200
        
        except Exception as e:
            return jsonify({"error": f"Database error: {str(e)}"}), 500


    @app.route("/api/live-inventory/decrease-stock", methods=["POST"])
    def live_inventory_decrease_stock():
        """
        [LIVE INVENTORY] Decrease stock by amount (doesn't go below 0)
        
        Body: {"inventory_id": <int>, "amount": <int>}
        Access: PHARMACIST ONLY
        """
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        
        data = request.get_json() or {}
        inventory_id = data.get("inventory_id")
        amount = data.get("amount", 1)
        
        if inventory_id is None:
            return jsonify({"error": "Missing inventory_id"}), 400
        
        try:
            amount = int(amount)
            if amount <= 0:
                return jsonify({"error": "Amount must be greater than 0"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid amount format"}), 400
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            cursor.execute(
                "SELECT pi.id, pi.quantity, pi.pharmacy_id FROM pharmacy_inventory pi WHERE pi.id = %s",
                (inventory_id,)
            )
            result = cursor.fetchone()
            
            if not result:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404
            
            pharmacy_id = result["pharmacy_id"]
            
            cursor.execute(
                "SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s",
                (pharmacy_id, user_id)
            )
            
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403
            
            new_quantity = max(0, (result["quantity"] or 0) - amount)
            cursor.execute(
                "UPDATE pharmacy_inventory SET quantity = %s WHERE id = %s",
                (new_quantity, inventory_id)
            )
            db.commit()
            cursor.close()
            db.close()
            
            return jsonify({
                "success": True,
                "message": f"Stock decreased by {amount}",
                "inventory_id": inventory_id,
                "new_quantity": new_quantity,
                "module": "live_inventory"
            }), 200
        
        except Exception as e:
            return jsonify({"error": f"Database error: {str(e)}"}), 500


    @app.route("/api/live-inventory/get-alerts", methods=["GET"])
    def live_inventory_get_alerts():
        """
        [LIVE INVENTORY] Get low stock alerts for pharmacist's pharmacy
        
        Returns: Medicines with low stock or out of stock
        Access: PHARMACIST ONLY
        """
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            cursor.execute(
                "SELECT id FROM pharmacies WHERE owner_id = %s",
                (user_id,)
            )
            pharmacy = cursor.fetchone()
            
            if not pharmacy:
                cursor.close()
                db.close()
                return jsonify({
                    "low_stock_count": 0,
                    "out_of_stock_count": 0,
                    "alerts": [],
                    "module": "live_inventory"
                }), 200
            
            pharmacy_id = pharmacy["id"]
            
            query = """
                SELECT 
                    pi.id,
                    pi.medicine_name,
                    pi.quantity,
                    CASE 
                        WHEN pi.quantity = 0 THEN 'out_of_stock'
                        WHEN pi.quantity <= 10 THEN 'low_stock'
                        ELSE 'normal'
                    END as status
                FROM pharmacy_inventory pi
                WHERE pi.pharmacy_id = %s AND pi.quantity <= 10
            """

            cursor.execute(query, (pharmacy_id,))
            alerts = cursor.fetchall()
            cursor.close()
            db.close()
            
            low_stock_count = sum(1 for a in alerts if a["status"] == "low_stock")
            out_of_stock_count = sum(1 for a in alerts if a["status"] == "out_of_stock")
            
            return jsonify({
                "low_stock_count": low_stock_count,
                "out_of_stock_count": out_of_stock_count,
                "alerts": alerts,
                "module": "live_inventory"
            }), 200

        except Exception as e:
            return jsonify({"error": f"Database error: {str(e)}"}), 500


    @app.route("/api/inventory", methods=["GET"])
    def api_inventory_get():
        return live_inventory_get()


    @app.route("/api/inventory", methods=["POST"])
    def api_inventory_add():
        return live_inventory_add_medicine()


    @app.route("/api/inventory/<int:inventory_id>", methods=["PUT"])
    def api_inventory_update(inventory_id):
        return live_inventory_update_details(inventory_id)


    @app.route("/api/inventory/<int:inventory_id>", methods=["DELETE"])
    def api_inventory_delete(inventory_id):
        return live_inventory_delete_item(inventory_id)


    @app.route("/api/inventory/<int:inventory_id>/adjust", methods=["PATCH"])
    def api_inventory_adjust(inventory_id):
        return live_inventory_adjust_quantity(inventory_id)


    @app.route("/api/inventory/<int:inventory_id>/restock", methods=["PATCH"])
    def api_inventory_restock(inventory_id):
        return live_inventory_restock(inventory_id)


    @app.route("/api/inventory/alerts", methods=["GET"])
    def api_inventory_alerts():
        return live_inventory_get_alerts()


    @app.route("/api/inventory/seed-defaults", methods=["POST"])
    def api_inventory_seed_defaults():
        return compat_my_pharmacy_initialize_stock()


    @app.route("/api/pharmacy/revenue/this-week", methods=["GET"])
    def pharmacy_revenue_this_week():
        """Return revenue grouped by day for the last 7 days for the pharmacist's pharmacy."""
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT id FROM pharmacies WHERE owner_id=%s", (user_id,))
            pharm = c.fetchone()
            if not pharm:
                return jsonify({"error": "No pharmacy found for user", "data": []}), 404
            pharmacy_id = pharm["id"]
            query = """
                SELECT DATE(created_at) as day, SUM(amount) as total
                FROM revenue_transactions
                WHERE pharmacy_id = %s AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY DATE(created_at)
                ORDER BY DATE(created_at)
            """
            c.execute(query, (pharmacy_id,))
            rows = c.fetchall() or []
            return jsonify({"data": rows})
        finally:
            db.close()


    @app.route("/api/pharmacy/critical-stock", methods=["GET"])
    def pharmacy_critical_stock():
        """Return inventory items where quantity is below threshold_limit (default 10)."""
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT id FROM pharmacies WHERE owner_id=%s", (user_id,))
            pharm = c.fetchone()
            if not pharm:
                return jsonify({"error": "No pharmacy found for user", "items": []}), 404
            pharmacy_id = pharm["id"]
            c.execute("SELECT * FROM pharmacy_inventory WHERE pharmacy_id=%s AND quantity < COALESCE(threshold_limit, 10) ORDER BY quantity ASC", (pharmacy_id,))
            items = c.fetchall() or []
            return jsonify({"items": items})
        finally:
            db.close()


    @app.route("/api/pharmacy/expiry-tracker", methods=["GET"])
    def pharmacy_expiry_tracker():
        """Count and list items expiring within 30 days."""
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT id FROM pharmacies WHERE owner_id=%s", (user_id,))
            pharm = c.fetchone()
            if not pharm:
                return jsonify({"error": "No pharmacy found for user", "items": [], "count": 0}), 404
            pharmacy_id = pharm["id"]
            query = """
                SELECT * FROM pharmacy_inventory
                WHERE pharmacy_id=%s AND expiry_date IS NOT NULL
                  AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                ORDER BY expiry_date ASC
            """
            c.execute(query, (pharmacy_id,))
            items = c.fetchall() or []
            return jsonify({"items": items, "count": len(items)})
        finally:
            db.close()



    def live_inventory_add_medicine():
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        data = request.get_json() or {}
        name = (data.get("name") or data.get("medicine_name") or "").strip()
        category = (data.get("category") or "Other").strip()
        dosage_form = (data.get("dosage_form") or data.get("form") or "Tablet").strip()
        manufacturer = (data.get("manufacturer") or "").strip()
        min_stock_level = int(data.get("min_stock_level") or 10)

        if not name:
            return jsonify({"error": "Medicine name is required"}), 400

        try:
            quantity = int(data.get("quantity")) if data.get("quantity") is not None else 20
        except (ValueError, TypeError):
            return jsonify({"error": "Quantity must be a number"}), 400

        if quantity < 0:
            return jsonify({"error": "Quantity cannot be negative"}), 400
        if quantity == 0:
            quantity = 20

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT id FROM pharmacies WHERE owner_id = %s", (user_id,))
            pharmacy = cursor.fetchone()
            if not pharmacy:
                cursor.close()
                db.close()
                return jsonify({"error": "You are not registered as a pharmacy owner"}), 403

            pharmacy_id = pharmacy["id"]
            lower_name = name.lower()

            cursor.execute(
                "SELECT id FROM pharmacy_inventory WHERE pharmacy_id = %s AND LOWER(medicine_name) = %s",
                (pharmacy_id, lower_name)
            )
            if cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "This medicine already exists in your inventory"}), 409

            cursor.execute(
                "SELECT id FROM medicines WHERE LOWER(name) = %s",
                (lower_name,)
            )
            existing_med = cursor.fetchone()
            if existing_med:
                cursor.execute(
                    "UPDATE medicines SET category = %s, dosage_form = %s, manufacturer = %s, min_stock_level = %s WHERE id = %s",
                    (category, dosage_form, manufacturer, min_stock_level, existing_med["id"])
                )
            else:
                cursor.execute(
                    "INSERT INTO medicines (name, category, dosage_form, manufacturer, quantity, min_stock_level) VALUES (%s,%s,%s,%s,%s,%s)",
                    (name, category, dosage_form, manufacturer, quantity, min_stock_level)
                )

            cursor.execute(
                "INSERT INTO pharmacy_inventory (pharmacy_id, medicine_name, quantity) VALUES (%s, %s, %s)",
                (pharmacy_id, name, quantity)
            )
            inventory_id = cursor.lastrowid
            db.commit()
            cursor.close()
            db.close()

            return jsonify({
                "success": True,
                "message": "Medicine added to inventory",
                "inventory_id": inventory_id,
                "quantity": quantity
            }), 201

        except Exception as e:
            return jsonify({"error": f"Error adding medicine: {str(e)}"}), 500


    def live_inventory_update_details(inventory_id):
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        data = request.get_json() or {}
        name = (data.get("name") or data.get("medicine_name") or "").strip()
        category = (data.get("category") or "").strip()
        dosage_form = (data.get("dosage_form") or data.get("form") or "").strip()
        manufacturer = (data.get("manufacturer") or "").strip()
        min_stock_level = data.get("min_stock_level")

        try:
            quantity = int(data.get("quantity")) if data.get("quantity") is not None else None
        except (ValueError, TypeError):
            return jsonify({"error": "Quantity must be a number"}), 400

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT pi.pharmacy_id, pi.medicine_name FROM pharmacy_inventory pi WHERE pi.id = %s", (inventory_id,))
            existing = cursor.fetchone()
            if not existing:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404

            cursor.execute(
                "SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s",
                (existing["pharmacy_id"], user_id)
            )
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403

            medicine_name = existing["medicine_name"]
            if name:
                medicine_name = name
                cursor.execute(
                    "UPDATE pharmacy_inventory SET medicine_name = %s WHERE id = %s",
                    (medicine_name, inventory_id)
                )

            if quantity is not None:
                if quantity < 0:
                    return jsonify({"error": "Quantity cannot be negative"}), 400
                cursor.execute(
                    "UPDATE pharmacy_inventory SET quantity = %s WHERE id = %s",
                    (quantity, inventory_id)
                )

            if name or category or dosage_form or manufacturer or min_stock_level is not None:
                cursor.execute("SELECT id FROM medicines WHERE LOWER(name) = %s", (medicine_name.lower(),))
                med = cursor.fetchone()
                if med:
                    updates = []
                    params = []
                    if category:
                        updates.append("category = %s")
                        params.append(category)
                    if dosage_form:
                        updates.append("dosage_form = %s")
                        params.append(dosage_form)
                    if manufacturer:
                        updates.append("manufacturer = %s")
                        params.append(manufacturer)
                    if min_stock_level is not None:
                        try:
                            lvl = int(min_stock_level)
                        except (ValueError, TypeError):
                            lvl = 10
                        updates.append("min_stock_level = %s")
                        params.append(lvl)
                    if updates:
                        params.append(med["id"])
                        cursor.execute(
                            f"UPDATE medicines SET {', '.join(updates)} WHERE id = %s",
                            tuple(params)
                        )
                else:
                    cursor.execute(
                        "INSERT INTO medicines (name, category, dosage_form, manufacturer, quantity, min_stock_level) VALUES (%s,%s,%s,%s,%s,%s)",
                        (medicine_name, category or "Other", dosage_form or "Tablet", manufacturer or "", quantity if quantity is not None else 20, int(min_stock_level or 10))
                    )

            db.commit()
            cursor.close()
            db.close()

            return jsonify({"success": True, "message": "Inventory item updated"}), 200

        except Exception as e:
            return jsonify({"error": f"Error updating inventory: {str(e)}"}), 500


    def live_inventory_delete_item(inventory_id):
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT pi.pharmacy_id FROM pharmacy_inventory pi WHERE pi.id = %s", (inventory_id,))
            existing = cursor.fetchone()
            if not existing:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404

            cursor.execute("SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s", (existing["pharmacy_id"], user_id))
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403

            cursor.execute("DELETE FROM pharmacy_inventory WHERE id = %s", (inventory_id,))
            db.commit()
            cursor.close()
            db.close()

            return jsonify({"success": True, "message": "Inventory item deleted"}), 200

        except Exception as e:
            return jsonify({"error": f"Error deleting inventory item: {str(e)}"}), 500


    def live_inventory_adjust_quantity(inventory_id):
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        data = request.get_json() or {}
        try:
            delta = int(data.get("delta", 0))
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid delta value"}), 400

        if delta == 0:
            return jsonify({"error": "Delta must be non-zero"}), 400

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT pi.pharmacy_id, pi.quantity FROM pharmacy_inventory pi WHERE pi.id = %s", (inventory_id,))
            existing = cursor.fetchone()
            if not existing:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404

            cursor.execute("SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s", (existing["pharmacy_id"], user_id))
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403

            new_qty = max(0, (existing["quantity"] or 0) + delta)
            cursor.execute("UPDATE pharmacy_inventory SET quantity = %s WHERE id = %s", (new_qty, inventory_id))
            db.commit()
            cursor.close()
            db.close()

            return jsonify({"success": True, "message": "Quantity adjusted", "new_quantity": new_qty}), 200

        except Exception as e:
            return jsonify({"error": f"Error adjusting quantity: {str(e)}"}), 500


    def live_inventory_restock(inventory_id):
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401

        data = request.get_json() or {}
        try:
            amount = int(data.get("add_quantity", 0))
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid restock amount"}), 400

        if amount <= 0:
            return jsonify({"error": "Add quantity must be greater than 0"}), 400

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT pi.pharmacy_id, pi.quantity FROM pharmacy_inventory pi WHERE pi.id = %s", (inventory_id,))
            existing = cursor.fetchone()
            if not existing:
                cursor.close()
                db.close()
                return jsonify({"error": "Inventory item not found"}), 404

            cursor.execute("SELECT id FROM pharmacies WHERE id = %s AND owner_id = %s", (existing["pharmacy_id"], user_id))
            if not cursor.fetchone():
                cursor.close()
                db.close()
                return jsonify({"error": "You do not own this pharmacy"}), 403

            new_qty = (existing["quantity"] or 0) + amount
            cursor.execute("UPDATE pharmacy_inventory SET quantity = %s WHERE id = %s", (new_qty, inventory_id))
            db.commit()
            cursor.close()
            db.close()

            return jsonify({"success": True, "message": "Stock restocked", "new_quantity": new_qty}), 200

        except Exception as e:
            return jsonify({"error": f"Error restocking inventory: {str(e)}"}), 500


    # ════════════════════════════════════════════════════════════════════════════════════
    # BACKWARD COMPATIBILITY: Old routes aliased to new modules
    # ════════════════════════════════════════════════════════════════════════════════════
    
    # Keep old routes for compatibility
    @app.route("/api/places/search", methods=["GET"])
    def compat_places_search():
        """Backward compat: redirect to pharmacy-finder/place-search"""
        return finder_search_by_place()
    
    @app.route("/api/inventory/live", methods=["GET"])
    def compat_inventory_live():
        """Backward compat: redirect to pharmacy-finder/medicine-search"""
        return finder_search_by_medicine()
    
    @app.route("/api/pharmacies/search-by-location", methods=["GET"])
    def compat_search_by_location():
        """Backward compat: redirect to pharmacy-finder/location-search"""
        return finder_search_by_location()
    
    @app.route("/api/my-pharmacy/inventory", methods=["GET"])
    def compat_my_pharmacy_inventory():
        """Backward compat: redirect to live-inventory/my-pharmacy"""
        return live_inventory_get()
    
    @app.route("/api/my-pharmacy/update-stock", methods=["POST"])
    def compat_my_pharmacy_update_stock():
        """Backward compat: redirect to live-inventory/update-stock"""
        return live_inventory_update_stock()
    
    @app.route("/api/my-pharmacy/increase-stock", methods=["POST"])
    def compat_my_pharmacy_increase_stock():
        """Backward compat: redirect to live-inventory/increase-stock"""
        return live_inventory_increase_stock()
    
    @app.route("/api/my-pharmacy/decrease-stock", methods=["POST"])
    def compat_my_pharmacy_decrease_stock():
        """Backward compat: redirect to live-inventory/decrease-stock"""
        return live_inventory_decrease_stock()
    
    @app.route("/api/my-pharmacy/get-alerts", methods=["GET"])
    def compat_my_pharmacy_get_alerts():
        """Backward compat: redirect to live-inventory/get-alerts"""
        return live_inventory_get_alerts()
    
    @app.route("/api/my-pharmacy/initialize-stock", methods=["POST"])
    def compat_my_pharmacy_initialize_stock():
        """Backward compat: Stock now auto-initializes on first access"""
        user_id = get_token_user(request)
        if not user_id:
            return jsonify({"error": "Unauthorized"}), 401
        
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            
            cursor.execute(
                "SELECT id FROM pharmacies WHERE owner_id = %s",
                (user_id,)
            )
            pharmacy = cursor.fetchone()
            
            if not pharmacy:
                cursor.close()
                db.close()
                return jsonify({"error": "You are not registered as a pharmacy"}), 403
            
            pharmacy_id = pharmacy["id"]
            was_initialized = _ensure_default_stock_for_pharmacy(db, pharmacy_id)
            
            if was_initialized:
                return jsonify({
                    "success": True,
                    "message": "Stock initialized with 20 units per medicine",
                    "inserted_count": 20,  # Approximate
                    "default_quantity": 20
                }), 200
            else:
                return jsonify({
                    "success": True,
                    "message": "Stock was already initialized",
                    "inserted_count": 0,
                    "default_quantity": 20
                }), 200
        
        except Exception as e:
            return jsonify({"error": f"Error: {str(e)}"}), 500
