let token = null;

document.addEventListener('DOMContentLoaded', () => {
    token = api.getTokenFromUrl();
    if (!token) {
        showMessage('Error', 'No approval token provided. This link is invalid.');
        return;
    }

    validateToken();

    document.getElementById('approve-form').addEventListener('submit', handleSubmitApproval);
});

function showView(viewId) {
    document.getElementById('approve-view').style.display = 'none';
    document.getElementById('loading-view').style.display = 'none';
    document.getElementById('message-view').style.display = 'none';
    document.getElementById(viewId).style.display = 'block';
}

function showMessage(title, text) {
    document.getElementById('message-title').textContent = title;
    document.getElementById('message-text').textContent = text;
    showView('message-view');
}

async function validateToken() {
    showView('loading-view');
    try {
        const profile = await api.request(`/public/approve/validate?token=${token}`, 'GET', null, false);
        // Pre-fill form
        document.getElementById('approve-name').value = profile.display_name;
        showView('approve-view');
    } catch (error) {
        showMessage('Error', error.message);
    }
}

async function handleSubmitApproval(e) {
    e.preventDefault();
    const errorEl = document.getElementById('approve-error');
    const submitBtn = document.getElementById('submit-approval-btn');
    const uploadStatus = document.getElementById('upload-status');
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const bio = document.getElementById('approve-bio').value;
    const files = document.getElementById('approve-photos').files;

    if (files.length === 0 || files.length > 3) {
        errorEl.textContent = 'Please select 1 to 3 photos.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Consent & Submit for Review';
        return;
    }

    // 1. Upload photos to Supabase Storage
    uploadStatus.textContent = 'Uploading photos...';
    const photoUrls = [];
    try {
        for (const file of files) {
            const fileName = `${Date.now()}-${file.name}`;
            const { data, error } = await supabase.storage
                .from('profile_photos') // Bucket name
                .upload(fileName, file);
            
            if (error) throw error;

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('profile_photos')
                .getPublicUrl(fileName);
            
            photoUrls.push(urlData.publicUrl);
        }
        uploadStatus.textContent = 'Upload complete!';
    } catch (error) {
        errorEl.textContent = `Photo upload failed: ${error.message}`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Consent & Submit for Review';
        return;
    }

    // 2. Submit bio and URLs to backend
    try {
        const payload = {
            bio: bio,
            photos: photoUrls
        };
        const result = await api.request(`/public/approve/complete?token=${token}`, 'POST', payload, false);
        showMessage('Success!', result.message);
    } catch (error) {
        errorEl.textContent = `Profile submission failed: ${error.message}`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Consent & Submit for Review';
    }
}