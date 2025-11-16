document.addEventListener('DOMContentLoaded', () => {
    // Redirect if already logged in
    if (api.isLoggedIn()) {
        window.location.href = 'dashboard.html';
    }

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');

    const showLogin = document.getElementById('show-login');
    const showRegister = document.getElementById('show-register');
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');

    // --- Toggle Views ---
    showRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginView.style.display = 'none';
        registerView.style.display = 'block';
    });
    showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerView.style.display = 'none';
        loginView.style.display = 'block';
    });

    // --- Login Handler ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const data = await api.request('/auth/login', 'POST', { username, password }, false);
            api.setToken(data.token);
            api.setUsername(data.username);
            window.location.href = 'dashboard.html';
        } catch (error) {
            loginError.textContent = error.message;
        }
    });

    // --- Register Handler ---
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerError.textContent = '';
        const username = document.getElementById('register-username').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;

        try {
            await api.request('/auth/register', 'POST', { username, email, password }, false);
            // On success, toggle to login view
            registerError.textContent = 'Registration successful! Please login.';
            showLogin.click();
        } catch (error) {
            registerError.textContent = error.message;
        }
    });
});