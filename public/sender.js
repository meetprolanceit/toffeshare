document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const fileInput = document.getElementById('fileInput');
    const createShareBtn = document.getElementById('createShareBtn');
    const shareInfo = document.getElementById('shareInfo');
    const shareLink = document.getElementById('shareLink');
    const copyBtn = document.getElementById('copyBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const transferStatus = document.getElementById('transferStatus');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    let file = null;
    let peers = new Map();
    let shareId = null;
    let activeTransfers = 0;
    let myPeer = null;

    function initializePeer() {
        myPeer = new Peer(generateRandomId());

        myPeer.on('open', (id) => {
            console.log('My peer ID is:', id);
            socket.emit('sender-peer-id', { peerId: id, shareId });
        });

        myPeer.on('error', (err) => {
            console.error('Peer.js error:', err);
            connectionStatus.textContent = `Peer.js error: ${err.message}`;
        });

        myPeer.on('connection', (conn) => {
            console.log('Incoming connection from:', conn.peer);
            handlePeerConnection(conn);
        });
    }

    function generateRandomId() {
        return 'sender-' + Math.random().toString(36).substr(2, 9);
    }

    createShareBtn.addEventListener('click', () => {
        file = fileInput.files[0];
        if (!file) {
            alert('Please select a file first');
            return;
        }

        socket.emit('create-share', (id) => {
            shareId = id;
            const link = `${window.location.origin}/share/${id}`;
            shareLink.value = link;
            shareInfo.classList.remove('hidden');
            connectionStatus.textContent = 'Waiting for receivers to connect...';

            const metadata = {
                name: file.name,
                size: file.size,
                type: file.type,
            };
            socket.emit('file-metadata', { shareId, metadata });

            initializePeer();
        });
    });

    copyBtn.addEventListener('click', () => {
        shareLink.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = 'Copy';
        }, 2000);
    });

    socket.on('receiver-joined', ({ receiverId, totalReceivers }) => {
        connectionStatus.textContent = `${totalReceivers} receiver(s) connected. Waiting for download requests...`;
    });

    socket.on('download-requested', ({ receiverId, receiverPeerId }) => {
        connectionStatus.textContent = `Receiver ${receiverId.substring(
            0,
            6
        )}... requested download. Establishing connection...`;
        const conn = myPeer.connect(receiverPeerId, {
            reliable: true,
        });

        handlePeerConnection(conn, receiverId);
    });

    function handlePeerConnection(conn, receiverId) {
        peers.set(conn.peer, {
            conn,
            progress: 0,
            sending: false,
            chunkIndex: 0,
            totalChunks: 0,
        });

        activeTransfers++;

        if (activeTransfers === 1) {
            transferStatus.classList.remove('hidden');
        }

        conn.on('open', () => {
            connectionStatus.textContent = `Connected to receiver Starting file transfer.`;

            const metadata = {
                name: file.name,
                size: file.size,
                type: file.type,
            };
            conn.send({
                type: 'metadata',
                data: metadata,
            });

            sendFile(file, conn);
            console.log('hello start time:==', Date.now());
        });

        conn.on('data', (data) => {
            if (data.type === 'ack') {
                console.log('Received ack for chunk:', data.index);
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            connectionStatus.textContent = `Connection error with receiver ${conn.peer.substring(0, 6)}...: ${
                err.message
            }`;
            cleanupPeer(conn.peer);
        });

        conn.on('close', () => {
            cleanupPeer(conn.peer);
        });
    }

    function sendFile(file, conn) {
        const chunkSize = 1024 * 1024; // 64KB chunks - a good balance
        const totalChunks = Math.ceil(file.size / chunkSize);
        const peerData = peers.get(conn.peer);

        if (peerData) {
            peerData.chunkIndex = 0;
            peerData.totalChunks = totalChunks;
        }
        function sendNextChunk() {
            if (!peers.has(conn.peer)) return;

            const peerData = peers.get(conn.peer);
            if (!peerData) return;

            const start = peerData.chunkIndex * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);

            const fileReader = new FileReader();

            fileReader.onload = (e) => {
                if (!peers.has(conn.peer)) return;

                try {
                    peerData.conn.send({
                        type: 'chunk',
                        data: {
                            index: peerData.chunkIndex,
                            total: peerData.totalChunks,
                            chunk: e.target.result,
                        },
                    });

                    const progress = Math.round(((peerData.chunkIndex + 1) / peerData.totalChunks) * 100);
                    peerData.progress = progress;
                    updateOverallProgress();

                    // Increment the chunkIndex for the next chunk
                    peerData.chunkIndex++;

                    // If there are more chunks, continue sending the next one
                    if (peerData.chunkIndex < peerData.totalChunks) {
                        requestAnimationFrame(sendNextChunk);
                        // sendNextChunk();
                    } else {
                        // If all chunks are sent, signal completion
                        peerData.conn.send({ type: 'complete' });
                        console.log('hello end time:==', Date.now());
                        connectionStatus.textContent = `File transfer complete for receiver ${conn.peer.substring(
                            0,
                            6
                        )}...`;
                    }
                } catch (error) {
                    console.error('Error sending chunk:', error);
                    // Implement retry logic here if needed
                }
            };

            fileReader.readAsArrayBuffer(chunk);
        }

        // Start sending chunks
        sendNextChunk();
    }

    // Update overall progress
    function updateOverallProgress() {
        let totalProgress = 0;
        peers.forEach((data) => {
            totalProgress += data.progress || 0;
        });

        const averageProgress = peers.size > 0 ? Math.round(totalProgress / peers.size) : 0;
        progressBar.style.width = `${averageProgress}%`;
        progressText.textContent = `${averageProgress}% (${peers.size} active transfer${peers.size !== 1 ? 's' : ''})`;
    }

    // Clean up peer connection
    function cleanupPeer(peerId) {
        const peerData = peers.get(peerId);
        if (peerData && peerData.conn) {
            peerData.conn.close();
            peers.delete(peerId);
            activeTransfers--;

            if (activeTransfers === 0) {
                connectionStatus.textContent = 'All transfers complete. Waiting for new receivers...';
            } else {
                updateOverallProgress();
            }
        }
    }

    socket.on('receiver-disconnected', ({ receiverId, totalReceivers }) => {
        connectionStatus.textContent = `Receiver ${receiverId.substring(
            0,
            6
        )}... disconnected. ${totalReceivers} receiver(s) still connected.`;
        // In Peer.js, we identify by peerId, not receiverId
        // We'll need to find the corresponding peerId if we want to clean up
    });

    socket.on('share-expired', () => {
        connectionStatus.textContent = 'Share has expired';
        // Clean up all peers
        peers.forEach((data, id) => {
            cleanupPeer(id);
        });

        // Close the Peer.js connection
        if (myPeer) {
            myPeer.destroy();
            myPeer = null;
        }
    });

    // Debug socket connection
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
});
