// This file contains reusable WebRTC logic
// It is heavily simplified and does not use a TURN server (per request).
// This will fail on symmetric NATs.

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

class PeerConnectionManager {
    constructor(localStream, socket) {
        this.localStream = localStream;
        this.socket = socket;
        this.peerConnections = {}; // Stores { sid: RTCPeerConnection }
        this.onRemoteStreamCallback = null;
    }

    // Called when a new user joins
    async createOffer(targetSid) {
        console.log(`Creating offer for ${targetSid}`);
        const pc = this.createPeer(targetSid);

        // Add local tracks
        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.socket.emit('webrtc_offer', {
                target_sid: targetSid,
                sdp: pc.localDescription
            });
        } catch (error) {
            console.error(`Error creating offer for ${targetSid}:`, error);
        }
    }

    // Called when an offer is received
    async handleOffer(offer, senderSid) {
        console.log(`Handling offer from ${senderSid}`);
        const pc = this.createPeer(senderSid);

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            
            // Add local tracks *before* creating answer
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.socket.emit('webrtc_answer', {
                target_sid: senderSid,
                sdp: pc.localDescription
            });
        } catch (error) {
            console.error(`Error handling offer from ${senderSid}:`, error);
        }
    }

    // Called when an answer is received
    async handleAnswer(answer, senderSid) {
        console.log(`Handling answer from ${senderSid}`);
        const pc = this.peerConnections[senderSid];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error(`Error handling answer from ${senderSid}:`, error);
            }
        }
    }

    // Called when an ICE candidate is received
    handleIceCandidate(candidate, senderSid) {
        // console.log(`Handling ICE candidate from ${senderSid}`);
        const pc = this.peerConnections[senderSid];
        if (pc) {
            try {
                pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error(`Error adding ICE candidate:`, error);
            }
        }
    }

    // Create and configure a new RTCPeerConnection
    createPeer(targetSid) {
        if (this.peerConnections[targetSid]) {
            return this.peerConnections[targetSid];
        }

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc_ice_candidate', {
                    target_sid: targetSid,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log(`Got remote track from ${targetSid}`);
            if (this.onRemoteStreamCallback) {
                this.onRemoteStreamCallback(event.streams[0], targetSid);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`ICE state for ${targetSid}: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                this.closePeer(targetSid);
            }
        };

        this.peerConnections[targetSid] = pc;
        return pc;
    }

    onRemoteStream(callback) {
        this.onRemoteStreamCallback = callback;
    }

    closePeer(sid) {
        if (this.peerConnections[sid]) {
            this.peerConnections[sid].close();
            delete this.peerConnections[sid];
            console.log(`Closed peer connection to ${sid}`);
        }
    }

    closeAllPeers() {
        for (const sid in this.peerConnections) {
            this.closePeer(sid);
        }
    }
}