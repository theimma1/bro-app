let roomName = null;
let userType = 'man'; // 'man' (observer) or 'woman' (broadcaster)
let localStream = null;
let peerManager = null;

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const callStatus = document.getElementById('call-status');
const leaveBtn = document.getElementById('leave-btn');
const container = document.getElementById('video-call-container');

document.addEventListener('DOMContentLoaded', async () => {
    leaveBtn.addEventListener('click', leaveCall);
    
    // Determine user type and get room name
    const womanToken = api.getTokenFromUrl();
    const manRoom = api.getRoomFromUrl();
    const manToken = api.token; // Man's JWT

    try {
        if (womanToken) {
            // This is the woman joining
            userType = 'woman';
            const data = await api.request(`/public/redeem/validate?token=${womanToken}`, 'GET', null, false);
            roomName = data.room_name;
            container.classList.remove('observer-view');
        } else if (manRoom && manToken) {
            // This is a man (observer) joining
            userType = 'man';
            roomName = manRoom;
            container.classList.add('observer-view');
        } else {
            throw new Error("Invalid join parameters.");
        }

        callStatus.textContent = `Joining room: ${roomName}...`;
        
        // 1. Get local media
        await setupLocalMedia();

        // 2. Initialize peer manager
        peerManager = new PeerConnectionManager(localStream, socket);
        
        // 3. Setup Socket.IO listeners
        setupSocketListeners();
        
        // 4. Join the room
        socket.emit('join_room', { room_name: roomName });
        callStatus.textContent = `In room: ${roomName}`;

    } catch (error) {
        callStatus.textContent = `Error: ${error.message}`;
    }
});

async function setupLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: userType === 'woman', // Men don't send video
            audio: userType === 'woman', // Men don't send audio
        });
        
        if (userType === 'woman') {
            localVideo.srcObject = localStream;
        }
    } catch (error) {
        console.error("Error getting user media:", error);
        callStatus.textContent = 'Error: Could not access camera/mic.';
        throw error;
    }
}

function setupSocketListeners() {
    // A new user (a man) has joined. If I am the woman, send them an offer.
    socket.on('user_joined', (data) => {
        const remoteSid = data.sid;
        console.log(`User ${remoteSid} joined`);
        if (userType === 'woman') {
            callStatus.textContent = 'New observer joined. Connecting...';
            peerManager.createOffer(remoteSid);
        }
    });

    // A user (the woman) left.
    socket.on('user_left', (data) => {
        console.log(`User ${data.sid} left`);
        callStatus.textContent = 'The other user left the call.';
        peerManager.closePeer(data.sid);
        if (userType === 'man') {
            remoteVideo.srcObject = null;
        }
    });

    // --- WebRTC Signaling ---
    socket.on('webrtc_offer', (data) => {
        // This is only received by the man
        if (userType === 'man') {
            console.log(`Received offer from ${data.sender_sid}`);
            callStatus.textContent = 'Receiving call...';
            peerManager.handleOffer(data.sdp, data.sender_sid);
        }
    });

    socket.on('webrtc_answer', (data) => {
        // This is only received by the woman
        if (userType === 'woman') {
            console.log(`Received answer from ${data.sender_sid}`);
            peerManager.handleAnswer(data.sdp, data.sender_sid);
        }
    });

    socket.on('webrtc_ice_candidate', (data) => {
        peerManager.handleIceCandidate(data.candidate, data.sender_sid);
    });
    
    // --- Stream Handling ---
    peerManager.onRemoteStream((stream, sid) => {
        // This is only received by the man
        if (userType === 'man') {
            console.log('Got remote stream!');
            remoteVideo.srcObject = stream;
            callStatus.textContent = 'Connected.';
        }
    });
}

function leaveCall() {
    if (socket) {
        socket.emit('leave_room', { room_name: roomName });
        socket.disconnect();
    }
    if (peerManager) {
        peerManager.closeAllPeers();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    window.location.href = 'dashboard.html';
}