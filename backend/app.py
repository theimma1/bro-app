import os
import eventlet
eventlet.monkey_patch()  # Patch standard libraries for eventlet

from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from dotenv import load_dotenv
import uuid
from datetime import datetime, timedelta, timezone

from db_utils import supabase
from auth_utils import (
    hash_password, verify_password, generate_jwt, token_required, SECRET_KEY
)

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get("JWT_SECRET")
# Allow all origins for simplicity. In production, lock this down.
CORS(app, resources={r"/*": {"origins": "*"}}) 
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# === ERROR HANDLING ===
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not Found"}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

# === HEALTH CHECK ===
@app.route('/')
def index():
    return jsonify({"status": "BRO API is running"}), 200

# === AUTHENTICATION ROUTES ===

@app.route('/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password') or not data.get('username'):
        return jsonify({"error": "Missing email, username, or password"}), 400

    try:
        hashed_pw = hash_password(data['password'])
        new_user = {
            'email': data['email'],
            'username': data['username'],
            'password_hash': hashed_pw
        }
        res = supabase.table('users').insert(new_user).execute()
        
        if res.data:
            return jsonify({"message": "User registered successfully"}), 201
        else:
            # Check for unique constraint violation
            if "users_email_key" in str(res.error):
                return jsonify({"error": "Email already exists"}), 409
            if "users_username_key" in str(res.error):
                return jsonify({"error": "Username already exists"}), 409
            return jsonify({"error": "Failed to register user", "details": str(res.error)}), 500
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({"error": "Missing username or password"}), 400

    try:
        res = supabase.table('users').select('*').eq('username', data['username']).execute()
        if not res.data:
            return jsonify({"error": "Invalid username or password"}), 401

        user = res.data[0]
        if verify_password(data['password'], user['password_hash']):
            token = generate_jwt(user['id'], user['email'])
            return jsonify({"token": token, "username": user['username']}), 200
        else:
            return jsonify({"error": "Invalid username or password"}), 401
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# === API ROUTES (Protected) ===

# --- Female Profiles ---

@app.route('/api/profiles', methods=['GET'])
@token_required
def get_profiles(current_user, **kwargs):
    # Get all profiles that are approved
    try:
        res = supabase.table('female_profiles').select('*').eq('moderation_status', 'approved').execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/profiles/<profile_id>', methods=['GET'])
@token_required
def get_profile_details(profile_id, current_user, **kwargs):
    try:
        # 1. Get profile
        profile_res = supabase.table('female_profiles').select('*').eq('id', profile_id).eq('moderation_status', 'approved').single().execute()
        if not profile_res.data:
            return jsonify({"error": "Profile not found or not approved"}), 404
        
        profile = profile_res.data

        # 2. Get experiences (approved)
        exp_res = supabase.table('experiences').select('*, user:users(username)').eq('profile_id', profile_id).eq('moderation_status', 'approved').execute()
        profile['experiences'] = exp_res.data

        # 3. Get average ratings
        # This is slow. A better way is a Postgres function or view.
        # For this build, we'll do it in the backend.
        ratings_res = supabase.table('ratings').select('honesty, communication, accountability, consistency, drama_level').eq('profile_id', profile_id).execute()
        
        avg_ratings = {
            "honesty": 0, "communication": 0, "accountability": 0,
            "consistency": 0, "drama_level": 0, "count": 0
        }
        if ratings_res.data:
            count = len(ratings_res.data)
            avg_ratings['count'] = count
            for r in ratings_res.data:
                avg_ratings['honesty'] += r['honesty']
                avg_ratings['communication'] += r['communication']
                avg_ratings['accountability'] += r['accountability']
                avg_ratings['consistency'] += r['consistency']
                avg_ratings['drama_level'] += r['drama_level']
            
            for key in avg_ratings:
                if key != 'count' and count > 0:
                    avg_ratings[key] = round(avg_ratings[key] / count, 1)

        profile['average_ratings'] = avg_ratings
        
        return jsonify(profile), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/profiles/invite', methods=['POST'])
@token_required
def create_profile_invite(current_user, current_user_id, **kwargs):
    data = request.get_json()
    if not data or not data.get('display_name'):
        return jsonify({"error": "Missing display_name"}), 400

    try:
        invite_token = str(uuid.uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(days=3)
        
        new_profile = {
            'display_name': data['display_name'],
            'created_by_user_id': current_user_id,
            'invite_token': invite_token,
            'invite_token_expires_at': expires_at.isoformat(),
            'moderation_status': 'pending' # Woman must approve *then* admin moderates
        }
        
        res = supabase.table('female_profiles').insert(new_profile).execute()
        if not res.data:
            return jsonify({"error": "Failed to create profile invite", "details": str(res.error)}), 500
        
        profile_id = res.data[0]['id']
        # This link would be sent via email/SMS (out of scope)
        invite_link = f"https://YOUR_VERCEL_APP_URL/approve.html?token={invite_token}"
        
        return jsonify({
            "message": "Profile invite created.",
            "profile_id": profile_id,
            "invite_link": invite_link 
        }), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Experiences & Ratings ---

@app.route('/api/profiles/<profile_id>/experience', methods=['POST'])
@token_required
def post_experience(profile_id, current_user, current_user_id, **kwargs):
    data = request.get_json()
    if not data or not data.get('experience_text'):
        return jsonify({"error": "Missing experience_text"}), 400
    
    # Simple PII filter (replace with a real library in production)
    if any(char.isdigit() for char in data['experience_text']) or '@' in data['experience_text']:
         return jsonify({"error": "Experience cannot contain numbers or email addresses to prevent doxxing."}), 400

    try:
        new_experience = {
            'profile_id': profile_id,
            'user_id': current_user_id,
            'experience_text': data['experience_text'],
            'tags': data.get('tags', []),
            'moderation_status': 'pending' # All posts must be moderated
        }
        res = supabase.table('experiences').insert(new_experience).execute()
        if not res.data:
            return jsonify({"error": "Failed to post experience", "details": str(res.error)}), 500
        
        return jsonify({"message": "Experience submitted for moderation.", "data": res.data[0]}), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/profiles/<profile_id>/rating', methods=['POST'])
@token_required
def post_rating(profile_id, current_user, current_user_id, **kwargs):
    data = request.get_json()
    required_keys = ['honesty', 'communication', 'accountability', 'consistency', 'drama_level']
    if not all(key in data and 0 <= data[key] <= 5 for key in required_keys):
        return jsonify({"error": "Missing or invalid rating keys. Must be 0-5."}), 400
        
    try:
        rating_data = {
            'profile_id': profile_id,
            'user_id': current_user_id,
            'honesty': data['honesty'],
            'communication': data['communication'],
            'accountability': data['accountability'],
            'consistency': data['consistency'],
            'drama_level': data['drama_level'],
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        
        # Use upsert to create or update the user's single rating for this profile
        res = supabase.table('ratings').upsert(rating_data, on_conflict='profile_id, user_id').execute()
        
        if not res.data:
            return jsonify({"error": "Failed to post rating", "details": str(res.error)}), 500
            
        return jsonify({"message": "Rating submitted.", "data": res.data[0]}), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/experiences/<experience_id>/vote', methods=['POST'])
@token_required
def vote_on_experience(experience_id, current_user, current_user_id, **kwargs):
    data = request.get_json()
    vote = data.get('vote')
    if vote not in [1, -1]:
        return jsonify({"error": "Vote must be 1 or -1"}), 400
        
    try:
        vote_data = {
            'experience_id': experience_id,
            'user_id': current_user_id,
            'vote': vote
        }
        res = supabase.table('experience_votes').upsert(vote_data, on_conflict='experience_id, user_id').execute()
        
        if not res.data:
            return jsonify({"error": "Failed to cast vote", "details": str(res.error)}), 500
        
        return jsonify({"message": "Vote cast.", "data": res.data[0]}), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Redeem Link Routes ---

@app.route('/api/profiles/<profile_id>/redeem', methods=['POST'])
@token_required
def create_redeem_session(profile_id, current_user, current_user_id, **kwargs):
    try:
        session_token = str(uuid.uuid4())
        room_name = str(uuid.uuid4()) # Unique room for this session
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        
        new_session = {
            'profile_id': profile_id,
            'created_by_user_id': current_user_id,
            'room_name': room_name,
            'session_token': session_token,
            'expires_at': expires_at.isoformat(),
            'is_active': True
        }
        
        res = supabase.table('redeem_sessions').insert(new_session).execute()
        if not res.data:
            return jsonify({"error": "Failed to create redeem session", "details": str(res.error)}), 500
            
        redeem_link = f"https://YOUR_VERCEL_APP_URL/redeem.html?token={session_token}"
        
        return jsonify({
            "message": "Redeem session created.",
            "redeem_link": redeem_link, # For the woman
            "room_name": room_name,     # For the man to join
            "token": session_token
        }), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# === PUBLIC ROUTES (Token-based) ===

@app.route('/public/approve/validate', methods=['GET'])
def validate_approve_token():
    token = request.args.get('token')
    if not token:
        return jsonify({"error": "Missing token"}), 400
        
    try:
        res = supabase.table('female_profiles').select('*').eq('invite_token', token).single().execute()
        if not res.data:
            return jsonify({"error": "Invalid or expired token"}), 404
            
        profile = res.data
        expires = datetime.fromisoformat(profile['invite_token_expires_at'])
        
        if expires < datetime.now(timezone.utc):
            return jsonify({"error": "Token has expired"}), 401
            
        # Return profile data so the page can pre-fill her display_name
        return jsonify(profile), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/public/approve/complete', methods=['POST'])
def complete_profile_approval():
    token = request.args.get('token')
    data = request.get_json()
    if not token or not data:
        return jsonify({"error": "Missing token or data"}), 400
    
    if not data.get('bio') or not data.get('photos'):
        return jsonify({"error": "Missing bio or photos"}), 400
        
    try:
        # 1. Validate token again
        res = supabase.table('female_profiles').select('id, invite_token_expires_at').eq('invite_token', token).single().execute()
        if not res.data:
            return jsonify({"error": "Invalid or expired token"}), 404
            
        profile = res.data
        expires = datetime.fromisoformat(profile['invite_token_expires_at'])
        if expires < datetime.now(timezone.utc):
            return jsonify({"error": "Token has expired"}), 401
            
        # 2. Update profile, set for moderation, and nullify token
        update_data = {
            'bio': data['bio'],
            'photos': data['photos'], # Expects a JSON list of URLs
            'invite_token': None,     # Burn the token
            'invite_token_expires_at': None,
            'moderation_status': 'pending' # NOW it goes to admin moderation
        }
        
        update_res = supabase.table('female_profiles').update(update_data).eq('id', profile['id']).execute()
        
        if not update_res.data:
            return jsonify({"error": "Failed to update profile", "details": str(update_res.error)}), 500
            
        return jsonify({"message": "Profile submitted for final review."}), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/public/redeem/validate', methods=['GET'])
def validate_redeem_token():
    # This validates the *woman's* token for the call
    token = request.args.get('token')
    if not token:
        return jsonify({"error": "Missing token"}), 400
        
    try:
        res = supabase.table('redeem_sessions').select('*').eq('session_token', token).single().execute()
        if not res.data:
            return jsonify({"error": "Invalid or expired session"}), 404
            
        session = res.data
        expires = datetime.fromisoformat(session['expires_at'])
        
        if expires < datetime.now(timezone.utc) or not session['is_active']:
            return jsonify({"error": "Session has expired"}), 401
            
        # Token is valid, return room name for Socket.IO
        return jsonify({
            "room_name": session['room_name'],
            "profile_id": session['profile_id'],
            "user_type": "woman"
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# === WEBRTC SIGNALING SERVER (Socket.IO) ===

@socketio.on('connect')
def on_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def on_disconnect():
    print(f'Client disconnected: {request.sid}')
    # In a real app, you'd find which room the sid was in and emit 'user_left'
    # For simplicity, we let clients handle missing peers via RTCPeerConnectionState

@socketio.on('join_room')
def on_join_room(data):
    room_name = data.get('room_name')
    if not room_name:
        return
        
    join_room(room_name)
    print(f"Client {request.sid} joined room {room_name}")
    
    # Notify others in the room (except sender) that a new peer has joined
    emit('user_joined', {'sid': request.sid}, to=room_name, skip_sid=request.sid)

@socketio.on('leave_room')
def on_leave_room(data):
    room_name = data.get('room_name')
    if not room_name:
        return
        
    leave_room(room_name)
    print(f"Client {request.sid} left room {room_name}")
    emit('user_left', {'sid': request.sid}, to=room_name, skip_sid=request.sid)

@socketio.on('webrtc_offer')
def on_offer(data):
    # Send offer to a specific target SID
    target_sid = data.get('target_sid')
    sdp = data.get('sdp')
    if not target_sid or not sdp:
        return
        
    print(f"Sending offer from {request.sid} to {target_sid}")
    emit('webrtc_offer', {
        'sdp': sdp,
        'sender_sid': request.sid
    }, to=target_sid)

@socketio.on('webrtc_answer')
def on_answer(data):
    # Send answer back to the original offerer
    target_sid = data.get('target_sid')
    sdp = data.get('sdp')
    if not target_sid or not sdp:
        return
        
    print(f"Sending answer from {request.sid} to {target_sid}")
    emit('webrtc_answer', {
        'sdp': sdp,
        'sender_sid': request.sid
    }, to=target_sid)

@socketio.on('webrtc_ice_candidate')
def on_ice_candidate(data):
    # Relay ICE candidate to the target peer
    target_sid = data.get('target_sid')
    candidate = data.get('candidate')
    if not target_sid or not candidate:
        return
        
    # print(f"Relaying ICE candidate from {request.sid} to {target_sid}")
    emit('webrtc_ice_candidate', {
        'candidate': candidate,
        'sender_sid': request.sid
    }, to=target_sid)

# --- Main Entry Point ---
if __name__ == '__main__':
    print("Starting Flask-SocketIO server with eventlet...")
    # Use Gunicorn in production, not this. This is for local dev.
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=True)