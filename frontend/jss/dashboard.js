document.addEventListener('DOMContentLoaded', () => {
    // Auth check
    if (!api.isLoggedIn()) {
        api.logout(); // Redirects to auth.html
        return;
    }

    // Setup Nav
    const usernameEl = document.getElementById('nav-username');
    const logoutBtn = document.getElementById('logout-btn');
    usernameEl.textContent = `Hi, ${api.getUsername()}`;
    logoutBtn.addEventListener('click', () => api.logout());

    // Load Profiles
    loadProfiles();
});

async function loadProfiles() {
    const grid = document.getElementById('profile-grid');
    try {
        const profiles = await api.request('/api/profiles', 'GET');

        if (profiles.length === 0) {
            grid.innerHTML = '<p>No approved profiles found yet.</p>';
            return;
        }

        grid.innerHTML = profiles.map(profile => createProfileCard(profile)).join('');

    } catch (error) {
        grid.innerHTML = `<p class="error-message">Failed to load profiles: ${error.message}</p>`;
    }
}

function createProfileCard(profile) {
    const firstPhoto = (profile.photos && profile.photos.length > 0) ? profile.photos[0] : 'https://via.placeholder.com/300x200?text=No+Photo';
    const bioSnippet = profile.bio ? profile.bio.substring(0, 100) + '...' : 'No bio provided.';

    return `
        <a href="profile.html?id=${profile.id}" class="profile-card">
            <img src="${firstPhoto}" alt="${profile.display_name}">
            <div class="profile-card-body">
                <h3>${profile.display_name}</h3>
                <p>${bioSnippet}</p>
            </div>
        </a>
    `;
}