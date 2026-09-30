# auth_utils.py

from functools import wraps

from flask import jsonify, request


def get_token_user(req):
    """Extract user_id from Bearer token. Returns None if invalid."""
    token = req.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if token.startswith("mg_token_"):
        try:
            return int(token.replace("mg_token_", ""))
        except Exception:
            pass
    return None


def get_current_user(req):
    """Resolve the logged-in user record from the bearer token."""
    user_id = get_token_user(req)
    if not user_id:
        return None

    from config import get_db

    db = None
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT id, name, email, role FROM users WHERE id=%s", (user_id,))
        return cursor.fetchone()
    except Exception:
        return None
    finally:
        if db:
            db.close()


def require_roles(*roles):
    """Decorator for simple role-based protection on Flask routes."""

    allowed_roles = {role.lower() for role in roles}

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user(request)
            if not user:
                return jsonify({"error": "Unauthorized"}), 401
            if allowed_roles and (user.get("role") or "").lower() not in allowed_roles:
                return jsonify({"error": "Unauthorized"}), 403

            request.current_user = user
            return fn(*args, **kwargs)

        return wrapper

    return decorator
