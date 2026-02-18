(() => {
    const ROOM_PREFIX = 'pinball-race-';
    let peer = null;
    let connections = []; // host keeps all connections
    let hostConn = null;  // guest keeps connection to host
    let isHost = false;
    let myName = '';
    let roomId = '';

    // DOM
    const chatStatus = document.getElementById('chat-status');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const chatLinkBox = document.getElementById('chat-link-box');
    const chatLinkInput = document.getElementById('chat-link');
    const btnCopyLink = document.getElementById('btn-copy-link');
    const chatUserCount = document.getElementById('chat-user-count');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const btnChatSend = document.getElementById('btn-chat-send');

    // Check URL for room ID
    const urlParams = new URLSearchParams(window.location.search);
    const joinRoomId = urlParams.get('room');

    if (joinRoomId) {
        // Auto-join mode
        btnCreateRoom.textContent = '접속 중...';
        btnCreateRoom.disabled = true;
        const name = prompt('채팅 닉네임을 입력하세요:') || ('Guest' + Math.floor(Math.random() * 1000));
        myName = name;
        joinRoom(joinRoomId);
    }

    btnCreateRoom.addEventListener('click', () => {
        const name = prompt('채팅 닉네임을 입력하세요:') || ('Host' + Math.floor(Math.random() * 1000));
        myName = name;
        createRoom();
    });

    btnCopyLink.addEventListener('click', () => {
        chatLinkInput.select();
        navigator.clipboard.writeText(chatLinkInput.value).then(() => {
            btnCopyLink.textContent = '완료!';
            setTimeout(() => btnCopyLink.textContent = '복사', 1500);
        });
    });

    btnChatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) sendMessage();
    });

    function setStatus(status) {
        chatStatus.textContent = status;
        chatStatus.className = 'chat-status ' + status;
    }

    function enableChat() {
        chatInput.disabled = false;
        btnChatSend.disabled = false;
    }

    function addSystemMsg(text) {
        const div = document.createElement('div');
        div.className = 'chat-msg system';
        div.textContent = text;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addChatMsg(name, text, color) {
        const div = document.createElement('div');
        div.className = 'chat-msg';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'msg-name';
        nameSpan.style.color = color || '#f0f';
        nameSpan.textContent = name + ':';
        div.appendChild(nameSpan);
        div.appendChild(document.createTextNode(' ' + text));
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function updateUserCount() {
        const count = isHost ? connections.length + 1 : (hostConn ? 2 : 1);
        chatUserCount.textContent = count;
    }

    // ===================== HOST =====================

    function createRoom() {
        isHost = true;
        roomId = ROOM_PREFIX + Math.random().toString(36).substring(2, 8);
        setStatus('connecting');
        btnCreateRoom.classList.add('hidden');

        peer = new Peer(roomId);

        peer.on('open', (id) => {
            setStatus('online');
            enableChat();

            // Build shareable link
            const url = new URL(window.location.href.split('?')[0]);
            url.searchParams.set('room', id);
            chatLinkInput.value = url.toString();
            chatLinkBox.classList.remove('hidden');
            updateUserCount();
            addSystemMsg('방이 생성되었습니다.');
            addSystemMsg(myName + ' 입장');
        });

        peer.on('connection', (conn) => {
            setupHostConnection(conn);
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            setStatus('offline');
            addSystemMsg('연결 오류: ' + err.type);
        });
    }

    function setupHostConnection(conn) {
        conn.on('open', () => {
            connections.push(conn);
            updateUserCount();

            conn.on('data', (data) => {
                if (data.type === 'join') {
                    conn._remoteName = data.name;
                    addSystemMsg(data.name + ' 입장');
                    // Broadcast join to all
                    broadcast({ type: 'system', text: data.name + ' 입장' }, conn);
                    // Send user count update
                    broadcastAll({ type: 'usercount', count: connections.length + 1 });
                } else if (data.type === 'chat') {
                    addChatMsg(data.name, data.text, data.color);
                    // Relay to all other connections
                    broadcast({ type: 'chat', name: data.name, text: data.text, color: data.color }, conn);
                }
            });

            conn.on('close', () => {
                const name = conn._remoteName || '???';
                connections = connections.filter(c => c !== conn);
                updateUserCount();
                addSystemMsg(name + ' 퇴장');
                broadcastAll({ type: 'system', text: name + ' 퇴장' });
                broadcastAll({ type: 'usercount', count: connections.length + 1 });
            });
        });
    }

    function broadcast(data, except) {
        for (const conn of connections) {
            if (conn !== except && conn.open) conn.send(data);
        }
    }

    function broadcastAll(data) {
        for (const conn of connections) {
            if (conn.open) conn.send(data);
        }
    }

    // ===================== GUEST =====================

    function joinRoom(targetRoomId) {
        isHost = false;
        roomId = targetRoomId;
        setStatus('connecting');

        peer = new Peer();

        peer.on('open', () => {
            hostConn = peer.connect(targetRoomId, { reliable: true });

            hostConn.on('open', () => {
                setStatus('online');
                enableChat();
                btnCreateRoom.classList.add('hidden');
                chatLinkBox.classList.add('hidden');
                updateUserCount();
                addSystemMsg(roomId.replace(ROOM_PREFIX, '') + ' 방에 접속했습니다.');

                // Generate a random color for this guest
                const colors = ['#ff00ff', '#00ff66', '#ffff00', '#bf5fff', '#ff6644', '#00ffff', '#ff3388', '#88ff00'];
                const myColor = colors[Math.floor(Math.random() * colors.length)];
                hostConn._myColor = myColor;

                // Send join message
                hostConn.send({ type: 'join', name: myName });
            });

            hostConn.on('data', (data) => {
                if (data.type === 'chat') {
                    addChatMsg(data.name, data.text, data.color);
                } else if (data.type === 'system') {
                    addSystemMsg(data.text);
                } else if (data.type === 'usercount') {
                    chatUserCount.textContent = data.count;
                }
            });

            hostConn.on('close', () => {
                setStatus('offline');
                addSystemMsg('호스트와 연결이 끊어졌습니다.');
                chatInput.disabled = true;
                btnChatSend.disabled = true;
            });
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            setStatus('offline');
            addSystemMsg('연결 오류: ' + err.type);
            btnCreateRoom.textContent = '방 만들기';
            btnCreateRoom.disabled = false;
        });
    }

    // ===================== SEND MESSAGE =====================

    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        const colors = ['#ff00ff', '#00ff66', '#ffff00', '#bf5fff', '#ff6644', '#00ffff', '#ff3388', '#88ff00'];
        const myColor = colors[myName.charCodeAt(0) % colors.length];

        // Show locally
        addChatMsg(myName, text, myColor);
        chatInput.value = '';

        const msgData = { type: 'chat', name: myName, text, color: myColor };

        if (isHost) {
            // Broadcast to all guests
            broadcastAll(msgData);
        } else if (hostConn && hostConn.open) {
            // Send to host
            hostConn.send(msgData);
        }
    }
})();
