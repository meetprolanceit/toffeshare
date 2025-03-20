// public/receiver.js - MODIFIED VERSION USING PEER.JS
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const shareId = window.location.pathname.split('/').pop();
    const connectionStatus = document.getElementById('connectionStatus');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName').querySelector('span');
    const fileSize = document.getElementById('fileSize').querySelector('span');
    const downloadBtn = document.getElementById('downloadBtn');
    const transferStatus = document.getElementById('transferStatus');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    let myPeer = null;
    let dataConnection = null;
    let fileMetadata = null;
    let receivedChunks = [];
    let bytesReceived = 0;
    let senderId = null;
    let senderPeerId = null;
    let downloadRequested = false;

    console.log('Joining share with ID:', shareId);
    function initializePeer() {
        myPeer = new Peer(generateRandomId(), {
            debug: 2,
        });

        myPeer.on('open', (id) => {
            console.log('My peer ID is:', id);
            socket.emit('receiver-peer-id', { peerId: id, shareId });
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
        return 'receiver-' + Math.random().toString(36).substr(2, 9);
    }

    socket.emit('join-share', shareId, (response) => {
        console.log('Join share response:', response);

        if (!response.success) {
            connectionStatus.textContent = response.message;
            return;
        }

        connectionStatus.textContent = 'Connected to share. Waiting for file information...';
        initializePeer();
        if (response.fileMetadata) {
            handleInitialMetadata(response.fileMetadata);
        }
    });

    socket.on('file-metadata', (metadata) => {
        handleInitialMetadata(metadata);
    });

    function handleInitialMetadata(metadata) {
        console.log('Received file metadata:', metadata);
        fileMetadata = metadata;
        fileName.textContent = metadata.name;
        fileSize.textContent = formatFileSize(metadata.size);
        fileInfo.classList.remove('hidden');

        downloadBtn.disabled = false;
        downloadBtn.addEventListener('click', () => {
            if (!downloadRequested) {
                downloadRequested = true;
                connectionStatus.textContent = 'Requesting file download...';
                socket.emit('request-download', {
                    shareId,
                    receiverPeerId: myPeer.id,
                });

                downloadBtn.disabled = true;
            }
        });
    }

    socket.on('sender-peer-id', ({ peerId }) => {
        console.log('Received sender peer ID:', peerId);
        senderPeerId = peerId;
        if (downloadRequested && !dataConnection) {
            initiateConnection();
        }
    });

    function initiateConnection() {
        if (!senderPeerId) {
            console.error('Cannot connect: No sender peer ID available');
            return;
        }

        connectionStatus.textContent = 'Connecting to sender...';

        dataConnection = myPeer.connect(senderPeerId, {
            reliable: true,
        });

        handlePeerConnection(dataConnection);
    }

    function handlePeerConnection(conn) {
        dataConnection = conn;

        conn.on('open', () => {
            console.log('Connection to sender established');
            connectionStatus.textContent = 'Connected to sender. Waiting for file...';
            transferStatus.classList.remove('hidden');
        });

        conn.on('data', (data) => {
            if (typeof data === 'object') {
                switch (data.type) {
                    case 'metadata':
                        handleTransferMetadata(data.data);
                        break;
                    case 'chunk':
                        handleChunk(data.data);
                        break;
                    case 'complete':
                        handleComplete();
                        break;
                }
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            connectionStatus.textContent = 'Connection error: ' + err.message;
        });

        conn.on('close', () => {
            console.log('Connection closed');
            dataConnection = null;
        });
    }

    function handleTransferMetadata(metadata) {
        console.log('Received transfer metadata:', metadata);
        fileMetadata = metadata;
        receivedChunks = new Array(Math.ceil(metadata.size / (64 * 1024)));
        bytesReceived = 0;
        connectionStatus.textContent = 'Receiving file...';
    }

    function handleChunk(data) {
        console.log(`🚀 ~ handleChunk ~ data:`, data);
        console.log(`Received chunk ${data.index}/${data.total}`);

        const chunk = new Uint8Array(data.chunk);
        receivedChunks[data.index] = chunk;

        bytesReceived += chunk.byteLength;

        const progress = Math.round((bytesReceived / fileMetadata.size) * 100);
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
    }

    function handleComplete() {
        console.log('hello end time:==', Date.now());
        console.log('File transfer complete');
        connectionStatus.textContent = 'File transfer complete!';

        const blob = new Blob(
            receivedChunks.filter((chunk) => chunk),
            { type: fileMetadata.type }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileMetadata.name;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);

        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download Again';
        downloadRequested = false;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' bytes';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        else return (bytes / 1073741824).toFixed(1) + ' GB';
    }

    socket.on('share-ended', ({ message }) => {
        connectionStatus.textContent = message || 'Share has ended';
        if (dataConnection) {
            dataConnection.close();
            dataConnection = null;
        }
        if (myPeer) {
            myPeer.destroy();
            myPeer = null;
        }
    });

    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
});
