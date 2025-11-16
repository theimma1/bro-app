// --- CONFIGURATION ---
// !! REPLACE THESE VALUES BEFORE DEPLOYING !!
const API_BASE_URL = "https://bro-app-backend.fly.dev"; // Your Fly.io backend URL
const SUPABASE_URL = "https://mjjhatzxqbrqyxplgdck.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qamhhdHp4cWJycXl4cGxnZGNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMyOTA0ODgsImV4cCI6MjA3ODg2NjQ4OH0.RS_iVB2YnFg5PJsLQznM5UZk2zN_IIbL_avGgXXCIbA";
// !! ----------------- !!

// Initialize Socket.IO connection
const socket = io(API_BASE_URL);

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- API Wrapper ---
class API {
    constructor() {
        this.baseUrl = API_BASE_URL;
        this.token = localStorage.getItem('bro_token');
    }

    getAuthHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };
    }

    async request(endpoint, method = 'GET', body = null, useAuth = true) {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (useAuth) {
            if (!this.token) {
                console.error("No auth token found for protected route.");
                window.location.href = 'auth.html';
                return;
            }
            options.headers['Authorization'] = `Bearer ${this.token}`;
        }

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);
            const data = await response.json();

            if (!response.ok) {
                // If unauthorized, redirect to login
                if (response.status === 401 && useAuth) {
                    this.logout();
                }
                // Pass the error message from the backend
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
            }
            
            return data;

        } catch (error) {
            console.error(`API Error (${method} ${endpoint}):`, error);
            throw error; // Re-throw to be caught by the caller
        }
    }

    // --- Auth Methods ---
    setToken(token) {
        this.token = token;
        localStorage.setItem('bro_token', token);
    }
    
    setUsername(username) {
        localStorage.setItem('bro_username', username);
    }

    logout() {
        localStorage.removeItem('bro_token');
        localStorage.removeItem('bro_username');
        this.token = null;
        window.location.href = 'index.html';
    }

    isLoggedIn() {
        return !!this.token;
    }
    
    getUsername() {
        return localStorage.getItem('bro_username');
    }

    // --- Helper Methods ---
    getProfileIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('id');
    }

    getTokenFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('token');
    }
    
    getRoomFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('room');
    }
}

// Global API instance
const api = new API();