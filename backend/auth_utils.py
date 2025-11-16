import jwt
import os
from functools import wraps
from flask import request, jsonify
from passlib.context import CryptContext
from db_utils import supabase
from datetime import datetime, timedelta

SECRET_KEY = os.environ.get("JWT_SECRET", "default-secret")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def generate_jwt(user_id: str, email: str) -> str:
    payload = {
        'exp': datetime.utcnow() + timedelta(days=1),
        'iat': datetime.utcnow(),
        'sub': user_id,
        'email': email
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            try:
                token = request.headers['Authorization'].split(" ")[1]
            except IndexError:
                return jsonify({"error": "Invalid Authorization header format. Use 'Bearer <token>'"}), 401

        if not token:
            return jsonify({"error": "Token is missing"}), 401

        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            # Fetch user from DB to ensure they still exist
            res = supabase.table('users').select('id').eq('id', data['sub']).execute()
            if not res.data:
                 return jsonify({"error": "User not found"}), 401
            
            # Pass user data to the route
            kwargs['current_user'] = res.data[0]
            kwargs['current_user_id'] = res.data[0]['id']
            
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Token is invalid"}), 401

        return f(*args, **kwargs)
    return decorated