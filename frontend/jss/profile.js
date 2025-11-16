let profileId = null;

document.addEventListener('DOMContentLoaded', () => {
    // Auth check
    if (!api.isLoggedIn()) {
        api.logout();
        return;
    }
    
    profileId = api.getProfileIdFromUrl();
    if (!profileId) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Setup Nav
    const usernameEl = document.getElementById('nav-username');
    const logoutBtn = document.getElementById('logout-btn');
    usernameEl.textContent = `Hi, ${api.getUsername()}`;
    logoutBtn.addEventListener('click', () => api.logout());

    // Load page data
    loadProfileDetails();

    // Setup form listeners
    document.getElementById('experience-form').addEventListener('submit', handlePostExperience);
    document.getElementById('rating-form').addEventListener('submit', handlePostRating);
});

async function loadProfileDetails() {
    try {
        const profile = await api.request(`/api/profiles/${profileId}`);
        
        // Render Header
        document.getElementById('profile-name').textContent = profile.display_name;
        document.getElementById('profile-bio').textContent = profile.bio;

        // Render Photos
        const photosContainer = document.getElementById('profile-photos');
        if (profile.photos && profile.photos.length > 0) {
            photosContainer.innerHTML = profile.photos.map(url => `<img src="${url}" alt="Profile photo">`).join('');
        } else {
            photosContainer.innerHTML = '<img src="https://via.placeholder.com/300x400?text=No+Photo" alt="No photo">';
        }

        // Render Ratings
        const ratingsContainer = document.getElementById('ratings-summary');
        const avg = profile.average_ratings;
        ratingsContainer.innerHTML = `
            <div class="rating-item"><span>Honesty:</span> <span>${avg.honesty}/5</span></div>
            <div class="rating-item"><span>Communication:</span> <span>${avg.communication}/5</span></div>
            <div class="rating-item"><span>Accountability:</span> <span>${avg.accountability}/5</span></div>
            <div class="rating-item"><span>Consistency:</span> <span>${avg.consistency}/5</span></div>
            <div class="rating-item"><span>Drama Level:</span> <span>${avg.drama_level}/5</span></div>
            <div class="rating-item" style="margin-top: 10px; color: var(--text-muted);"><span>Total Ratings:</span> <span>${avg.count}</span></div>
        `;

        // Render Experiences
        const experiencesContainer = document.getElementById('experiences-list');
        if (profile.experiences && profile.experiences.length > 0) {
            experiencesContainer.innerHTML = profile.experiences.map(exp => createExperiencePost(exp)).join('');
        } else {
            experiencesContainer.innerHTML = '<p>No experiences submitted yet.</p>';
        }

    } catch (error) {
        document.getElementById('profile-container').innerHTML = `<h1 class="error-message">Error: ${error.message}</h1>`;
    }
}

function createExperiencePost(exp) {
    const postDate = new Date(exp.created_at).toLocaleDateString();
    return `
        <div class="experience-post" data-id="${exp.id}">
            <p class="experience-meta">By <span>${exp.user.username}</span> on ${postDate}</p>
            <p>${exp.experience_text}</p>
            <div class="experience-votes">
                <span>Accuracy:</span>
                <button class="vote-btn" onclick="handleVote('${exp.id}', 1)">▲ Upvote</button>
                <button class="vote-btn" onclick="handleVote('${exp.id}', -1)">▼ Downvote</button>
                </div>
        </div>
    `;
}

async function handlePostExperience(e) {
    e.preventDefault();
    const errorEl = document.getElementById('experience-error');
    const text = document.getElementById('experience-text').value;
    errorEl.textContent = '';

    try {
        await api.request(`/api/profiles/${profileId}/experience`, 'POST', { experience_text: text });
        document.getElementById('experience-text').value = '';
        errorEl.textContent = 'Experience submitted for moderation.';
        // Note: Post won't appear until re-load and approved
    } catch (error) {
        errorEl.textContent = error.message;
    }
}

async function handlePostRating(e) {
    e.preventDefault();
    const errorEl = document.getElementById('rating-error');
    errorEl.textContent = '';
    
    try {
        const rating = {
            honesty: parseInt(document.getElementById('rating-honesty').value),
            communication: parseInt(document.getElementById('rating-communication').value),
            accountability: parseInt(document.getElementById('rating-accountability').value),
            consistency: parseInt(document.getElementById('rating-consistency').value),
            drama_level: parseInt(document.getElementById('rating-drama_level').value),
        };

        await api.request(`/api/profiles/${profileId}/rating`, 'POST', rating);
        errorEl.textContent = 'Rating submitted/updated!';
        // Reload ratings
        loadProfileDetails(); 
    } catch (error) {
        errorEl.textContent = error.message;
    }
}

async function handleVote(experienceId, vote) {
    try {
        await api.request(`/api/experiences/${experienceId}/vote`, 'POST', { vote });
        alert('Vote cast!');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}