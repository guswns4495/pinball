(() => {
    const { Engine, Runner, Bodies, Body, Composite, Events } = Matter;

    // --- Layout ---
    const CANVAS_W = 660;
    const CANVAS_H = 5400;
    const WALL_T = 14;
    const PIN_RADIUS = 5;
    const BALL_RADIUS = 9;
    const FINISH_Y = CANVAS_H - 50;

    // Wall narrowing
    const NARROW_START_Y = CANVAS_H * 0.65;
    const NARROW_END_WIDTH = 150;

    const NEON_COLORS = [
        '#ff00ff', '#00ff66', '#ffff00', '#bf5fff',
        '#ff6644', '#00ffff', '#ff3388', '#88ff00',
        '#ff4488', '#44ffcc', '#ffaa00', '#aa88ff',
        '#ff2200', '#00ffaa', '#ddff00', '#ff66aa',
        '#66aaff', '#ccff66', '#ff8866', '#88ddff',
        '#ff55cc', '#55ffaa', '#aaff44', '#cc66ff',
        '#ff9944', '#44ddff', '#ff2266', '#66ff88',
        '#ddaa00', '#00aaff', '#ff77aa', '#77ffdd',
        '#ee44aa', '#44ffee', '#ffcc44', '#aa44dd',
        '#ff8800', '#00ff88', '#dd00ff', '#88ffaa',
    ];

    // --- Stages ---
    // Each stage occupies a vertical band with its own obstacle theme
    const STAGES = [
        { name: 'PIN FIELD',     yStart: 100,  yEnd: 1100, color: '#00e5ff', type: 'pins' },
        { name: 'BUMPER ZONE',   yStart: 1100, yEnd: 1980, color: '#ff9100', type: 'bumpers' },
        { name: 'SPINNER ALLEY', yStart: 1980, yEnd: 2860, color: '#d050ff', type: 'spinners' },
        { name: 'RAMP CANYON',   yStart: 2860, yEnd: 3740, color: '#00e676', type: 'ramps' },
        { name: 'LAUNCH PAD',   yStart: 3740, yEnd: 4620, color: '#ff1744', type: 'launchers' },
        { name: 'FINAL RUN',    yStart: 4620, yEnd: 5350, color: '#ffea00', type: 'final' },
    ];

    // --- State ---
    let engine, runner, animFrameId;
    let participants = [];
    let winnerCount = 1;
    let balls = [];
    let zones = [];
    let obstacles = [];
    let wallBumps = [];
    let wormholes = [];       // { x, y, r, side, stageIdx, body, color, pairType:'entry'|'exit', hitTime }
    let rotatingGates = [];   // { x, y, w, body, speed }
    let finishSensor = null;
    let gameRunning = false;
    let finishOrder = [];
    let raceComplete = false;
    let zoneParticles = [];
    let fireworks = [];
    let fireworksRunning = false;

    // --- DOM ---
    const setupPanel = document.getElementById('setup-panel');
    const gameArea = document.getElementById('game-area');
    const canvas = document.getElementById('pinball-canvas');
    const btnStart = document.getElementById('btn-start');
    const btnDrop = document.getElementById('btn-drop');
    const btnReset = document.getElementById('btn-reset');
    const winnerOverlay = document.getElementById('winner-overlay');
    const winnerText = document.getElementById('winner-text');
    const winnerList = document.getElementById('winner-list');
    const namesInput = document.getElementById('names-input');
    const winnerCountInput = document.getElementById('winner-count');
    const scoreboard = document.getElementById('scoreboard');
    const fireworksCanvas = document.getElementById('fireworks-canvas');
    const liveRanking = document.getElementById('live-ranking');

    btnStart.addEventListener('click', startGame);
    btnDrop.addEventListener('click', dropBalls);
    btnReset.addEventListener('click', resetGame);

    // ===================== WALL HELPERS =====================

    function getWallX(y) {
        if (y <= NARROW_START_Y) return { left: WALL_T, right: CANVAS_W - WALL_T };
        const t = Math.min(1, (y - NARROW_START_Y) / (FINISH_Y - NARROW_START_Y));
        const eased = t * t;
        const halfW = (CANVAS_W - WALL_T * 2) / 2;
        const halfNarrow = NARROW_END_WIDTH / 2;
        const cx = CANVAS_W / 2;
        return {
            left: cx - halfW + (halfW - halfNarrow) * eased,
            right: cx + halfW - (halfW - halfNarrow) * eased,
        };
    }

    // ===================== SETUP =====================

    function startGame() {
        const raw = namesInput.value.trim();
        if (!raw) return;
        participants = raw.split('\n').map(n => n.trim()).filter(n => n.length > 0);
        if (participants.length < 2) return alert('2명 이상의 참가자를 입력하세요.');
        if (participants.length > 40) return alert('최대 40명까지 가능합니다.');

        winnerCount = Math.max(1, Math.min(
            parseInt(winnerCountInput.value) || 1,
            participants.length - 1
        ));

        setupPanel.classList.add('hidden');
        gameArea.classList.remove('hidden');
        winnerOverlay.classList.add('hidden');

        buildScoreboard();
        initPhysics();
        buildMap();
        dropBalls();
    }

    function buildScoreboard() {
        scoreboard.innerHTML = '';
        participants.forEach((name, i) => {
            const color = NEON_COLORS[i % NEON_COLORS.length];
            const chip = document.createElement('div');
            chip.className = 'score-chip';
            chip.id = 'chip-' + i;
            chip.style.borderColor = color;
            chip.style.color = color;
            chip.style.textShadow = `0 0 6px ${color}`;
            chip.innerHTML = `<span class="score-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>${name}`;
            scoreboard.appendChild(chip);
        });
    }

    // ===================== PHYSICS =====================

    function initPhysics() {
        engine = Engine.create();
        engine.gravity.y = 0.42;
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        runner = Runner.create();
        Runner.run(runner, engine);
        Events.on(engine, 'collisionStart', onCollision);
        animFrameId = requestAnimationFrame(renderLoop);
    }

    // ===================== MAP BUILD =====================

    function buildMap() {
        const bodies = [];
        wallBumps = [];
        obstacles = [];
        zones = [];
        zoneParticles = [];

        const wo = { isStatic: true, restitution: 0.4, friction: 0, label: 'wall' };
        bodies.push(Bodies.rectangle(CANVAS_W / 2, WALL_T / 2, CANVAS_W, WALL_T, wo));
        bodies.push(Bodies.rectangle(CANVAS_W / 2, CANVAS_H - WALL_T / 2, CANVAS_W, WALL_T, wo));

        // Wavy narrowing walls
        const bumpRadius = 14;
        const bumpSpacing = 42;
        const bumpCount = Math.floor((CANVAS_H - 80) / bumpSpacing);
        const bumpOpts = { isStatic: true, restitution: 0.8, friction: 0, label: 'wallbump' };

        for (let i = 0; i < bumpCount; i++) {
            const by = 50 + i * bumpSpacing;
            const wave = Math.sin(i * 0.5) * 8;
            const wallPos = getWallX(by);
            const leftX = wallPos.left + bumpRadius - 2 + wave;
            const rightX = wallPos.right - bumpRadius + 2 - wave;
            bodies.push(Bodies.circle(leftX, by, bumpRadius, bumpOpts));
            bodies.push(Bodies.circle(rightX, by, bumpRadius, bumpOpts));
            wallBumps.push(
                { x: leftX, y: by, r: bumpRadius, side: 'left' },
                { x: rightX, y: by, r: bumpRadius, side: 'right' }
            );
        }

        const po = { isStatic: true, restitution: 0.6, friction: 0, label: 'pin' };

        // Helper: get safe placement area at a Y
        function getSafeArea(y) {
            const wallPos = getWallX(y);
            return {
                left: wallPos.left + bumpRadius * 2 + 15,
                right: wallPos.right - bumpRadius * 2 - 15,
            };
        }

        // ============================
        // STAGE 1: PIN FIELD — sparse, irregular pins
        // ============================
        const s1 = STAGES[0];
        const pinGapY = 48;
        const pinRows = Math.floor((s1.yEnd - s1.yStart) / pinGapY);
        for (let row = 0; row < pinRows; row++) {
            const y = s1.yStart + 30 + row * pinGapY;
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            const baseCols = Math.floor(availW / 52);
            // Random: skip 1~2 pins per row for irregularity
            const skip1 = Math.floor(Math.random() * baseCols);
            const skip2 = Math.floor(Math.random() * baseCols);
            const offset = (row % 2 === 0 ? 0 : 26) + (Math.random() - 0.5) * 8;

            for (let col = 0; col < baseCols; col++) {
                if (col === skip1 || col === skip2) continue;
                const x = area.left + 20 + col * (availW - 40) / Math.max(1, baseCols - 1) + offset;
                if (x > area.left + 10 && x < area.right - 10) {
                    bodies.push(Bodies.circle(x, y + (Math.random() - 0.5) * 6, PIN_RADIUS, po));
                }
            }

            // Scatter a few zones in pin field
            if (Math.random() < 0.15) {
                const zoneTypes = ['jump', 'speed'];
                const type = zoneTypes[Math.floor(Math.random() * 2)];
                const zw = 44 + Math.random() * 16;
                const zh = 18;
                const zx = area.left + Math.random() * (availW - zw - 20) + 10;
                addZone(bodies, type, zx, y - 5, zw, zh);
            }
        }

        // ============================
        // STAGE 2: BUMPER ZONE — bouncy circles (8 main + 2 ramps as accents)
        // ============================
        const s2 = STAGES[1];
        addSparsePins(bodies, po, s2, getSafeArea, 65, 5);

        for (let i = 0; i < 8; i++) {
            const y = s2.yStart + 35 + (s2.yEnd - s2.yStart - 70) * (i / 7);
            const area = getSafeArea(y);
            const r = 14 + Math.random() * 10;
            const x = area.left + r + 20 + Math.random() * (area.right - area.left - r * 2 - 40);
            const b = Bodies.circle(x, y, r, {
                isStatic: true, restitution: 1.4, friction: 0, label: 'bumper',
            });
            bodies.push(b);
            obstacles.push({ type: 'bumper', x, y, r, body: b, hitTime: 0 });
        }
        // Accent: 2 small ramps
        for (let i = 0; i < 2; i++) {
            const y = s2.yStart + 80 + i * 160;
            const area = getSafeArea(y);
            const rw = 45 + Math.random() * 20;
            const x = area.left + rw / 2 + Math.random() * (area.right - area.left - rw);
            const angle = (i % 2 === 0 ? 1 : -1) * 0.3;
            const bar = Bodies.rectangle(x, y, rw, 5, { isStatic: true, restitution: 0.4, friction: 0, label: 'ramp', angle });
            bodies.push(bar);
            obstacles.push({ type: 'ramp', x, y, w: rw, h: 5, body: bar, angle });
        }
        addStageZones(bodies, s2, getSafeArea, 2, ['speed', 'vortex']);

        // ============================
        // STAGE 3: SPINNER ALLEY — rotating bars (7 main + 2 bumpers as accents)
        // ============================
        const s3 = STAGES[2];
        addSparsePins(bodies, po, s3, getSafeArea, 65, 5);

        for (let i = 0; i < 7; i++) {
            const y = s3.yStart + 35 + (s3.yEnd - s3.yStart - 70) * (i / 6);
            const area = getSafeArea(y);
            const sw = 50 + Math.random() * 30;
            const x = area.left + sw / 2 + 15 + Math.random() * (area.right - area.left - sw - 30);
            const bar = Bodies.rectangle(x, y, sw, 5, {
                isStatic: true, restitution: 0.5, friction: 0, label: 'spinner',
            });
            bodies.push(bar);
            obstacles.push({
                type: 'spinner', x, y, w: sw, h: 5, body: bar,
                speed: (i % 2 === 0 ? 1 : -1) * (0.012 + Math.random() * 0.01),
            });
        }
        // Accent: 2 bumpers
        for (let i = 0; i < 2; i++) {
            const y = s3.yStart + 60 + i * 180;
            const area = getSafeArea(y);
            const r = 12 + Math.random() * 8;
            const x = area.left + r + 20 + Math.random() * (area.right - area.left - r * 2 - 40);
            const b = Bodies.circle(x, y, r, { isStatic: true, restitution: 1.2, friction: 0, label: 'bumper' });
            bodies.push(b);
            obstacles.push({ type: 'bumper', x, y, r, body: b, hitTime: 0 });
        }
        addStageZones(bodies, s3, getSafeArea, 2, ['slow', 'vortex']);

        // ============================
        // STAGE 4: RAMP CANYON — angled deflectors (7 main + 2 spinners as accents)
        // ============================
        const s4 = STAGES[3];
        addSparsePins(bodies, po, s4, getSafeArea, 65, 5);

        for (let i = 0; i < 7; i++) {
            const y = s4.yStart + 35 + (s4.yEnd - s4.yStart - 70) * (i / 6);
            const area = getSafeArea(y);
            const rw = 50 + Math.random() * 30;
            const x = area.left + rw / 2 + 15 + Math.random() * (area.right - area.left - rw - 30);
            const angle = (i % 2 === 0 ? 1 : -1) * (0.25 + Math.random() * 0.25);
            const bar = Bodies.rectangle(x, y, rw, 5, {
                isStatic: true, restitution: 0.4, friction: 0, label: 'ramp', angle,
            });
            bodies.push(bar);
            obstacles.push({ type: 'ramp', x, y, w: rw, h: 5, body: bar, angle });
        }
        // Accent: 2 spinners
        for (let i = 0; i < 2; i++) {
            const y = s4.yStart + 70 + i * 170;
            const area = getSafeArea(y);
            const sw = 45 + Math.random() * 20;
            const x = area.left + sw / 2 + Math.random() * (area.right - area.left - sw);
            const bar = Bodies.rectangle(x, y, sw, 5, { isStatic: true, restitution: 0.5, friction: 0, label: 'spinner' });
            bodies.push(bar);
            obstacles.push({ type: 'spinner', x, y, w: sw, h: 5, body: bar, speed: (i % 2 === 0 ? 1 : -1) * 0.015 });
        }
        addStageZones(bodies, s4, getSafeArea, 3, ['jump', 'speed', 'slow']);

        // ============================
        // STAGE 5: LAUNCH PAD — launchers (6 main + 3 bumpers as accents)
        // ============================
        const s5 = STAGES[4];
        addSparsePins(bodies, po, s5, getSafeArea, 70, 4);

        for (let i = 0; i < 6; i++) {
            const y = s5.yStart + 40 + (s5.yEnd - s5.yStart - 80) * (i / 5);
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            if (availW < 50) continue;
            const x = area.left + 30 + Math.random() * (availW - 60);
            const lb = Bodies.circle(x, y, 16, {
                isStatic: true, isSensor: true, label: 'launcher',
            });
            bodies.push(lb);
            obstacles.push({ type: 'launcher', x, y, r: 16, body: lb, hitTime: 0 });
        }
        // Accent: 3 small bumpers
        for (let i = 0; i < 3; i++) {
            const y = s5.yStart + 60 + i * 110;
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            if (availW < 40) continue;
            const r = 10 + Math.random() * 6;
            const x = area.left + r + 10 + Math.random() * (availW - r * 2 - 20);
            const b = Bodies.circle(x, y, r, { isStatic: true, restitution: 1.3, friction: 0, label: 'bumper' });
            bodies.push(b);
            obstacles.push({ type: 'bumper', x, y, r, body: b, hitTime: 0 });
        }
        addStageZones(bodies, s5, getSafeArea, 2, ['jump', 'vortex']);

        // ============================
        // STAGE 6: FINAL RUN — mixed gauntlet (sparse pins + 3 bumpers + 2 launchers)
        // ============================
        const s6 = STAGES[5];
        for (let row = 0; row < 5; row++) {
            const y = s6.yStart + 25 + row * 42;
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            if (availW < 50) continue;
            const cols = Math.max(2, Math.floor(availW / 55));
            for (let col = 0; col < cols; col++) {
                if (Math.random() < 0.35) continue;
                const x = area.left + 15 + (availW - 30) * (col / Math.max(1, cols - 1));
                bodies.push(Bodies.circle(x, y + (Math.random() - 0.5) * 8, PIN_RADIUS, po));
            }
        }
        // 3 small bumpers in the narrowing
        for (let i = 0; i < 3; i++) {
            const y = s6.yStart + 30 + i * 65;
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            if (availW < 40) continue;
            const r = 10 + Math.random() * 5;
            const x = area.left + r + 8 + Math.random() * (availW - r * 2 - 16);
            const b = Bodies.circle(x, y, r, { isStatic: true, restitution: 1.2, friction: 0, label: 'bumper' });
            bodies.push(b);
            obstacles.push({ type: 'bumper', x, y, r, body: b, hitTime: 0 });
        }
        // 2 launchers for last-second drama
        for (let i = 0; i < 2; i++) {
            const y = s6.yStart + 50 + i * 80;
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            if (availW < 45) continue;
            const x = area.left + 20 + Math.random() * (availW - 40);
            const lb = Bodies.circle(x, y, 14, { isStatic: true, isSensor: true, label: 'launcher' });
            bodies.push(lb);
            obstacles.push({ type: 'launcher', x, y, r: 14, body: lb, hitTime: 0 });
        }

        // ============================
        // WORMHOLES — each stage 0-4 gets 1 exit wormhole on wall, stage 5 gets 2 entry wormholes
        // ============================
        wormholes = [];
        const WORMHOLE_R = 18;

        // Exit wormholes (stages 0-4): placed on alternating walls
        for (let si = 0; si < 5; si++) {
            const stage = STAGES[si];
            const wy = stage.yStart + (stage.yEnd - stage.yStart) * (0.4 + Math.random() * 0.3);
            const wallPos = getWallX(wy);
            const side = si % 2 === 0 ? 'left' : 'right';
            const wx = side === 'left' ? wallPos.left + WORMHOLE_R + 8 : wallPos.right - WORMHOLE_R - 8;
            const wb = Bodies.circle(wx, wy, WORMHOLE_R, {
                isStatic: true, isSensor: true, label: 'wormhole_exit_' + si,
            });
            bodies.push(wb);
            wormholes.push({ x: wx, y: wy, r: WORMHOLE_R, side, stageIdx: si, body: wb, color: stage.color, pairType: 'exit', hitTime: 0 });
        }

        // Entry wormholes (stage 5 - FINAL RUN): 2 wormholes on walls
        const s6Final = STAGES[5];
        for (let i = 0; i < 2; i++) {
            const wy = s6Final.yStart + 120 + i * 280;
            const wallPos = getWallX(wy);
            const side = i === 0 ? 'left' : 'right';
            const wx = side === 'left' ? wallPos.left + WORMHOLE_R + 8 : wallPos.right - WORMHOLE_R - 8;
            const wb = Bodies.circle(wx, wy, WORMHOLE_R, {
                isStatic: true, isSensor: true, label: 'wormhole_entry_' + i,
            });
            bodies.push(wb);
            wormholes.push({ x: wx, y: wy, r: WORMHOLE_R, side, stageIdx: 5, body: wb, color: s6Final.color, pairType: 'entry', hitTime: 0 });
        }

        // ============================
        // ROTATING GATES — slow-spinning barriers before finish
        // ============================
        rotatingGates = [];
        const gateY1 = FINISH_Y - 120;
        const gateY2 = FINISH_Y - 60;
        for (const gy of [gateY1, gateY2]) {
            const gWall = getWallX(gy);
            const gw = (gWall.right - gWall.left) * 0.7;
            const gx = CANVAS_W / 2;
            const gateBody = Bodies.rectangle(gx, gy, gw, 6, {
                isStatic: true, restitution: 0.3, friction: 0.1, label: 'gate',
            });
            bodies.push(gateBody);
            rotatingGates.push({ x: gx, y: gy, w: gw, body: gateBody, speed: gy === gateY1 ? 0.018 : -0.018 });
        }

        // ============================
        // BOUNCE WALL SEGMENTS — part of the wall itself
        // Right side: near rotating gates, Left side: a bit higher
        // ============================
        const bwRightY = FINISH_Y - 80;  // 회전문 근처
        const bwLeftY = FINISH_Y - 200;  // 좀 더 윗쪽
        const bwHeight = 60;

        // Right wall bounce segment — replaces wall bumps in that range
        const bwRWall = getWallX(bwRightY);
        for (let dy = -bwHeight / 2; dy <= bwHeight / 2; dy += 15) {
            const y = bwRightY + dy;
            const wp = getWallX(y);
            const bumpBody = Bodies.circle(wp.right - 12, y, 14, {
                isStatic: true, restitution: 1.8, friction: 0, label: 'wallbounce_right',
            });
            bodies.push(bumpBody);
        }
        obstacles.push({ type: 'wallbounce', side: 'right', y: bwRightY, h: bwHeight, hitTime: 0 });

        // Left wall bounce segment — higher up
        for (let dy = -bwHeight / 2; dy <= bwHeight / 2; dy += 15) {
            const y = bwLeftY + dy;
            const wp = getWallX(y);
            const bumpBody = Bodies.circle(wp.left + 12, y, 14, {
                isStatic: true, restitution: 1.8, friction: 0, label: 'wallbounce_left',
            });
            bodies.push(bumpBody);
        }
        obstacles.push({ type: 'wallbounce', side: 'left', y: bwLeftY, h: bwHeight, hitTime: 0 });

        // Finish line sensor
        const finishWall = getWallX(FINISH_Y);
        finishSensor = Bodies.rectangle(CANVAS_W / 2, FINISH_Y, finishWall.right - finishWall.left - 10, 6, {
            isStatic: true, isSensor: true, label: 'finish',
        });
        bodies.push(finishSensor);

        Composite.add(engine.world, bodies);
    }

    // --- Map helpers ---

    function addSparsePins(bodies, po, stage, getSafeArea, gapY, maxSkip) {
        const rows = Math.floor((stage.yEnd - stage.yStart) / gapY);
        for (let row = 0; row < rows; row++) {
            const y = stage.yStart + 20 + row * gapY;
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            const baseCols = Math.floor(availW / 58);
            const skipCount = 1 + Math.floor(Math.random() * Math.min(maxSkip, baseCols - 1));
            const skips = new Set();
            while (skips.size < skipCount) skips.add(Math.floor(Math.random() * baseCols));

            const offset = (row % 2 === 0 ? 0 : 29) + (Math.random() - 0.5) * 10;
            for (let col = 0; col < baseCols; col++) {
                if (skips.has(col)) continue;
                const x = area.left + 20 + col * (availW - 40) / Math.max(1, baseCols - 1) + offset;
                if (x > area.left + 10 && x < area.right - 10) {
                    bodies.push(Bodies.circle(x, y + (Math.random() - 0.5) * 8, PIN_RADIUS, po));
                }
            }
        }
    }

    function addZone(bodies, type, x, y, w, h) {
        const isBonus = type === 'jump' || type === 'speed';
        const zoneBody = Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
            isStatic: true, isSensor: true, label: 'zone_' + type,
        });
        bodies.push(zoneBody);
        zones.push({ body: zoneBody, type, x, y, w, h, isBonus, hitTime: 0 });
    }

    function addStageZones(bodies, stage, getSafeArea, count, typePool) {
        for (let i = 0; i < count; i++) {
            const y = stage.yStart + 40 + (stage.yEnd - stage.yStart - 80) * ((i + 0.5) / count);
            const area = getSafeArea(y);
            const availW = area.right - area.left;
            if (availW < 60) continue;
            const type = typePool[Math.floor(Math.random() * typePool.length)];
            const zw = 40 + Math.random() * 16;
            const zh = 18;
            const zx = area.left + 10 + Math.random() * (availW - zw - 20);
            addZone(bodies, type, zx, y, zw, zh);
        }
    }

    // ===================== DROP =====================

    function dropBalls() {
        if (gameRunning) return;
        btnDrop.disabled = true;
        gameRunning = true;
        raceComplete = false;
        finishOrder = [];
        balls = [];

        const spacing = Math.min(40, (CANVAS_W - WALL_T * 2 - 80) / participants.length);
        const totalW = spacing * (participants.length - 1);
        const startX = (CANVAS_W - totalW) / 2;

        participants.forEach((name, i) => {
            const x = startX + i * spacing + (Math.random() - 0.5) * 8;
            const color = NEON_COLORS[i % NEON_COLORS.length];
            const body = Bodies.circle(x, 36 + Math.random() * 10, BALL_RADIUS, {
                restitution: 0.4, friction: 0.05, density: 0.0012, label: 'ball_' + i,
            });
            Composite.add(engine.world, body);
            balls.push({ body, name, color, idx: i, trail: [], finished: false, stuckTimer: 0, warpCooldown: 0 });
        });
    }

    // ===================== ANTI-STUCK =====================

    function unstickBalls() {
        for (const bi of balls) {
            if (bi.finished) continue;
            const vel = bi.body.velocity;
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
            const by = bi.body.position.y;
            const bx = bi.body.position.x;
            const wallPos = getWallX(by);

            if (bx < wallPos.left + BALL_RADIUS + 5) {
                Body.setPosition(bi.body, { x: wallPos.left + BALL_RADIUS + 8, y: by });
                Body.setVelocity(bi.body, { x: Math.abs(vel.x) + 1, y: vel.y });
            }
            if (bx > wallPos.right - BALL_RADIUS - 5) {
                Body.setPosition(bi.body, { x: wallPos.right - BALL_RADIUS - 8, y: by });
                Body.setVelocity(bi.body, { x: -(Math.abs(vel.x) + 1), y: vel.y });
            }

            if (speed < 0.4) {
                bi.stuckTimer++;
                if (bi.stuckTimer > 50) {
                    Body.setVelocity(bi.body, {
                        x: (Math.random() - 0.5) * 5,
                        y: 2 + Math.random() * 3,
                    });
                    bi.stuckTimer = 0;
                }
            } else {
                bi.stuckTimer = Math.max(0, bi.stuckTimer - 1);
            }
        }
    }

    // ===================== COLLISION =====================

    function onCollision(event) {
        if (!gameRunning) return;

        for (const pair of event.pairs) {
            const a = pair.bodyA, b = pair.bodyB;
            let ballInfo = null, other = null;
            for (const bi of balls) {
                if (bi.body === a) { ballInfo = bi; other = b; break; }
                if (bi.body === b) { ballInfo = bi; other = a; break; }
            }
            if (!ballInfo || ballInfo.finished) continue;
            const label = other.label;

            if (label === 'zone_jump') {
                Body.setVelocity(ballInfo.body, { x: ballInfo.body.velocity.x * 0.6, y: -8 - Math.random() * 3 });
                spawnZoneParticles(ballInfo.body.position, '#00ff66', 'up');
                markZoneHit(other);
            } else if (label === 'zone_speed') {
                Body.setVelocity(ballInfo.body, { x: ballInfo.body.velocity.x * 1.4, y: ballInfo.body.velocity.y * 1.3 });
                spawnZoneParticles(ballInfo.body.position, '#00ff66', 'burst');
                markZoneHit(other);
            } else if (label === 'zone_slow') {
                Body.setVelocity(ballInfo.body, { x: ballInfo.body.velocity.x * 0.2, y: ballInfo.body.velocity.y * 0.2 });
                spawnZoneParticles(ballInfo.body.position, '#ff3344', 'slow');
                markZoneHit(other);
            } else if (label === 'zone_vortex') {
                Body.setVelocity(ballInfo.body, { x: ballInfo.body.velocity.x + (Math.random() > 0.5 ? 4 : -4), y: ballInfo.body.velocity.y });
                spawnZoneParticles(ballInfo.body.position, '#ff3344', 'swirl');
                markZoneHit(other);
            }

            if (label === 'bumper') {
                const obs = obstacles.find(o => o.body === other);
                if (obs) obs.hitTime = Date.now();
                const angle = Math.atan2(ballInfo.body.position.y - other.position.y, ballInfo.body.position.x - other.position.x);
                const sp = Math.sqrt(ballInfo.body.velocity.x ** 2 + ballInfo.body.velocity.y ** 2);
                const power = Math.max(4, sp * 1.2);
                Body.setVelocity(ballInfo.body, { x: Math.cos(angle) * power, y: Math.sin(angle) * power });
            }

            if (label === 'launcher') {
                const obs = obstacles.find(o => o.body === other);
                if (obs) obs.hitTime = Date.now();
                Body.setVelocity(ballInfo.body, { x: (Math.random() - 0.5) * 4, y: -(10 + Math.random() * 5) });
                spawnZoneParticles(ballInfo.body.position, '#ff1744', 'up');
            }

            // Wall bounce segments — random deflection
            if (label === 'wallbounce_right') {
                const obs = obstacles.find(o => o.type === 'wallbounce' && o.side === 'right');
                if (obs) obs.hitTime = Date.now();
                const power = 3 + Math.random() * 6;
                const upPower = -(2 + Math.random() * 5);
                Body.setVelocity(ballInfo.body, { x: -power, y: upPower });
                spawnZoneParticles(ballInfo.body.position, '#ffea00', 'burst');
            }
            if (label === 'wallbounce_left') {
                const obs = obstacles.find(o => o.type === 'wallbounce' && o.side === 'left');
                if (obs) obs.hitTime = Date.now();
                const power = 3 + Math.random() * 6;
                const upPower = -(2 + Math.random() * 5);
                Body.setVelocity(ballInfo.body, { x: power, y: upPower });
                spawnZoneParticles(ballInfo.body.position, '#ffea00', 'burst');
            }

            // Wormhole entry → teleport to random exit
            if (label.startsWith('wormhole_entry_')) {
                const wh = wormholes.find(w => w.body === other);
                if (wh && Date.now() - (ballInfo.warpCooldown || 0) > 1500) {
                    const exits = wormholes.filter(w => w.pairType === 'exit');
                    if (exits.length > 0) {
                        const dest = exits[Math.floor(Math.random() * exits.length)];
                        wh.hitTime = Date.now();
                        dest.hitTime = Date.now();
                        const offsetX = dest.side === 'left' ? 30 : -30;
                        Body.setPosition(ballInfo.body, { x: dest.x + offsetX, y: dest.y });
                        Body.setVelocity(ballInfo.body, { x: (Math.random() - 0.5) * 3, y: 2 + Math.random() * 2 });
                        ballInfo.warpCooldown = Date.now();
                        spawnZoneParticles({ x: wh.x, y: wh.y }, wh.color, 'burst');
                        spawnZoneParticles({ x: dest.x, y: dest.y }, dest.color, 'burst');
                    }
                }
            }

            if (label === 'finish') {
                ballInfo.finished = true;
                finishOrder.push(ballInfo);
                Body.setVelocity(ballInfo.body, { x: 0, y: 0.5 });
                const rank = finishOrder.length;
                const chip = document.getElementById('chip-' + ballInfo.idx);
                if (chip) {
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
                    chip.innerHTML += ` <span style="margin-left:4px">${medal}</span>`;
                    if (rank <= winnerCount) chip.classList.add('winner');
                }
                if (rank === winnerCount) showWinners();
                if (finishOrder.length >= balls.length) gameRunning = false;
            }
        }
    }

    function markZoneHit(zoneBody) {
        const z = zones.find(z => z.body === zoneBody);
        if (z) z.hitTime = Date.now();
    }

    function spawnZoneParticles(pos, color, style) {
        const count = style === 'slow' ? 6 : 10;
        for (let i = 0; i < count; i++) {
            let vx, vy;
            if (style === 'up') { vx = (Math.random() - 0.5) * 2; vy = -2 - Math.random() * 3; }
            else if (style === 'burst') { const a = Math.random() * Math.PI * 2; const s = 1.5 + Math.random() * 2; vx = Math.cos(a) * s; vy = Math.sin(a) * s; }
            else if (style === 'slow') { vx = (Math.random() - 0.5) * 0.5; vy = (Math.random() - 0.5) * 0.5; }
            else { const a = Math.random() * Math.PI * 2; vx = Math.cos(a) * 2; vy = Math.sin(a) * 2; }
            zoneParticles.push({ x: pos.x, y: pos.y, vx, vy, life: 1, decay: 0.025 + Math.random() * 0.02, color, size: 2 + Math.random() * 2, style });
        }
    }

    function updateSpinners() {
        for (const obs of obstacles) {
            if (obs.type === 'spinner') Body.setAngle(obs.body, obs.body.angle + obs.speed);
        }
        for (const gate of rotatingGates) {
            Body.setAngle(gate.body, gate.body.angle + gate.speed);
        }
    }

    function getCameraTarget() {
        let bestY = -Infinity, target = null;
        for (const bi of balls) {
            if (!bi.finished && bi.body.position.y > bestY) {
                bestY = bi.body.position.y;
                target = bi;
            }
        }
        return target;
    }

    // ===================== LIVE RANKING =====================

    function updateLiveRanking() {
        if (!balls.length) return;
        const sorted = [...balls].sort((a, b) => {
            if (a.finished && b.finished) return finishOrder.indexOf(a) - finishOrder.indexOf(b);
            if (a.finished) return -1;
            if (b.finished) return 1;
            return b.body.position.y - a.body.position.y;
        });

        let html = '<div class="rank-title">LIVE RANK</div>';
        sorted.forEach((bi, i) => {
            const rank = i + 1;
            const stageName = getStageForY(bi.body.position.y);
            const finishedClass = bi.finished ? ' finished' : '';
            const medal = bi.finished ? (finishOrder.indexOf(bi) === 0 ? '🥇' : finishOrder.indexOf(bi) === 1 ? '🥈' : finishOrder.indexOf(bi) === 2 ? '🥉' : '') : '';
            html += `<div class="rank-item${finishedClass}" style="color:${bi.color};border-left:3px solid ${bi.color}">
                <span class="rank-num">${medal || rank}</span>
                <span class="rank-dot" style="background:${bi.color};box-shadow:0 0 4px ${bi.color}"></span>
                <span class="rank-name">${bi.name}</span>
                <span class="rank-stage">${bi.finished ? 'GOAL' : stageName}</span>
            </div>`;
        });
        liveRanking.innerHTML = html;
    }

    function getStageForY(y) {
        for (const s of STAGES) {
            if (y >= s.yStart && y < s.yEnd) return s.name.split(' ')[0];
        }
        return '';
    }

    // ===================== WINNER =====================

    function showWinners() {
        raceComplete = true;
        const winners = finishOrder.slice(0, winnerCount);
        winnerText.innerHTML = winnerCount === 1 ? '🏆 WINNER 🏆' : `🏆 TOP ${winnerCount} 🏆`;
        winnerList.innerHTML = '';
        winners.forEach((bi, i) => {
            const entry = document.createElement('div');
            entry.className = 'winner-entry';
            entry.style.borderColor = bi.color;
            entry.style.color = bi.color;
            entry.style.textShadow = `0 0 10px ${bi.color}, 0 0 25px ${bi.color}`;
            entry.style.boxShadow = `0 0 15px ${bi.color}66, inset 0 0 10px ${bi.color}33`;
            entry.style.animationDelay = `${i * 0.25}s`;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            entry.textContent = `${medal} ${bi.name}`;
            winnerList.appendChild(entry);
        });
        winnerOverlay.classList.remove('hidden');
        startFireworks();
    }

    // ===================== FIREWORKS =====================

    function startFireworks() {
        fireworksRunning = true; fireworks = [];
        const wrap = document.getElementById('canvas-wrap');
        fireworksCanvas.width = wrap.clientWidth;
        fireworksCanvas.height = wrap.clientHeight;
        let launches = 0;
        const interval = setInterval(() => {
            if (launches >= 35 || !fireworksRunning) { clearInterval(interval); return; }
            const cx = Math.random() * fireworksCanvas.width;
            const cy = Math.random() * fireworksCanvas.height * 0.6;
            const color = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
            const particles = [];
            for (let i = 0; i < 45; i++) {
                const angle = (Math.PI * 2 * i) / 45 + (Math.random() - 0.5) * 0.3;
                const speed = 2 + Math.random() * 4;
                particles.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, decay: 0.01 + Math.random() * 0.012, size: 2 + Math.random() * 2.5 });
            }
            fireworks.push({ color, particles });
            launches++;
        }, 180);
        requestAnimationFrame(renderFireworks);
    }

    function renderFireworks() {
        if (!fireworksRunning) return;
        const ctx = fireworksCanvas.getContext('2d');
        ctx.clearRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);
        let alive = false;
        for (let fi = fireworks.length - 1; fi >= 0; fi--) {
            const fw = fireworks[fi]; let anyAlive = false;
            for (const p of fw.particles) {
                if (p.life <= 0) continue; anyAlive = true; alive = true;
                p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= p.decay;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
                ctx.shadowBlur = 12; ctx.shadowColor = fw.color;
                ctx.fillStyle = fw.color + hexAlpha(p.life * 0.9); ctx.fill(); ctx.shadowBlur = 0;
            }
            if (!anyAlive) fireworks.splice(fi, 1);
        }
        if (alive || fireworks.length > 0) requestAnimationFrame(renderFireworks);
        else fireworksRunning = false;
    }

    function stopFireworks() {
        fireworksRunning = false; fireworks = [];
        const ctx = fireworksCanvas.getContext('2d');
        ctx.clearRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);
    }

    // ===================== RESET =====================

    function resetGame() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        stopFireworks();
        if (engine) { Runner.stop(runner); Composite.clear(engine.world); Engine.clear(engine); }
        engine = null; balls = []; zones = []; obstacles = []; wallBumps = [];
        wormholes = []; rotatingGates = [];
        finishSensor = null; gameRunning = false; raceComplete = false;
        finishOrder = []; zoneParticles = [];
        liveRanking.innerHTML = '';
        winnerOverlay.classList.add('hidden');
        gameArea.classList.add('hidden');
        setupPanel.classList.remove('hidden');
        btnDrop.disabled = false;
    }

    // ===================== RENDER =====================

    function renderLoop() {
        const ctx = canvas.getContext('2d');
        const w = CANVAS_W, h = CANVAS_H, now = Date.now();

        ctx.fillStyle = '#0a0a2e';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = 'rgba(0, 100, 255, 0.04)'; ctx.lineWidth = 1;
        for (let gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
        for (let gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

        if (!engine) { animFrameId = requestAnimationFrame(renderLoop); return; }

        updateSpinners();
        unstickBalls();
        if (gameRunning) updateLiveRanking();

        // === Stage backgrounds & dividers ===
        for (const stage of STAGES) {
            const stageH = stage.yEnd - stage.yStart;

            // Background gradient tint
            const grad = ctx.createLinearGradient(0, stage.yStart, 0, stage.yEnd);
            grad.addColorStop(0, stage.color + '12');
            grad.addColorStop(0.5, stage.color + '18');
            grad.addColorStop(1, stage.color + '08');
            ctx.fillStyle = grad;
            ctx.fillRect(0, stage.yStart, w, stageH);

            // Side edge glow
            const edgeGrad = ctx.createLinearGradient(0, 0, 40, 0);
            edgeGrad.addColorStop(0, stage.color + '20');
            edgeGrad.addColorStop(1, stage.color + '00');
            ctx.fillStyle = edgeGrad;
            ctx.fillRect(0, stage.yStart, 40, stageH);
            const edgeGradR = ctx.createLinearGradient(w, 0, w - 40, 0);
            edgeGradR.addColorStop(0, stage.color + '20');
            edgeGradR.addColorStop(1, stage.color + '00');
            ctx.fillStyle = edgeGradR;
            ctx.fillRect(w - 40, stage.yStart, 40, stageH);

            // Divider line
            ctx.shadowBlur = 8; ctx.shadowColor = stage.color;
            ctx.strokeStyle = stage.color + '55'; ctx.lineWidth = 1.5;
            ctx.setLineDash([10, 8]);
            const wPos = getWallX(stage.yStart);
            ctx.beginPath(); ctx.moveTo(wPos.left + 10, stage.yStart); ctx.lineTo(wPos.right - 10, stage.yStart); ctx.stroke();
            ctx.setLineDash([]);

            // Stage name
            ctx.fillStyle = stage.color + '88';
            ctx.font = '700 11px Orbitron, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(stage.name, wPos.left + 20, stage.yStart + 18);
            ctx.shadowBlur = 0;
        }

        // === Wavy walls ===
        ctx.lineWidth = 3;
        for (const side of ['left', 'right']) {
            const bumps = wallBumps.filter(b => b.side === side);
            if (bumps.length < 2) continue;
            ctx.shadowBlur = 10; ctx.shadowColor = '#0066ff'; ctx.strokeStyle = '#0066ff';
            ctx.beginPath(); ctx.moveTo(bumps[0].x, WALL_T);
            for (let i = 0; i < bumps.length - 1; i++) {
                const curr = bumps[i], next = bumps[i + 1];
                ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
            }
            ctx.lineTo(bumps[bumps.length - 1].x, h - WALL_T);
            ctx.stroke(); ctx.shadowBlur = 0;
        }

        // Top/bottom walls
        ctx.shadowBlur = 8; ctx.shadowColor = '#0066ff'; ctx.strokeStyle = '#0066ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(WALL_T, WALL_T); ctx.lineTo(w - WALL_T, WALL_T); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(WALL_T, h - WALL_T); ctx.lineTo(w - WALL_T, h - WALL_T); ctx.stroke();
        ctx.shadowBlur = 0;

        // === Zones ===
        for (const z of zones) {
            const color = z.isBonus ? '#00ff66' : '#ff3344';
            const flash = Math.max(0, 1 - (now - z.hitTime) / 400);
            ctx.shadowBlur = 8 + flash * 15; ctx.shadowColor = color;
            ctx.fillStyle = color + hexAlpha(0.08 + flash * 0.2);
            ctx.strokeStyle = color + hexAlpha(0.4 + flash * 0.5); ctx.lineWidth = 1.5;
            roundRect(ctx, z.x, z.y, z.w, z.h, 4); ctx.fill();
            roundRect(ctx, z.x, z.y, z.w, z.h, 4); ctx.stroke();
            ctx.shadowBlur = 0;
            const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
            ctx.shadowBlur = 6; ctx.shadowColor = color;
            if (z.type === 'jump') {
                ctx.fillStyle = color; ctx.beginPath();
                ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 5, cy + 4); ctx.lineTo(cx + 5, cy + 4);
                ctx.closePath(); ctx.fill();
            } else if (z.type === 'speed') {
                ctx.fillStyle = color; ctx.beginPath();
                ctx.moveTo(cx + 1, cy - 7); ctx.lineTo(cx - 4, cy + 1); ctx.lineTo(cx, cy);
                ctx.lineTo(cx - 1, cy + 7); ctx.lineTo(cx + 4, cy - 1); ctx.lineTo(cx, cy);
                ctx.closePath(); ctx.fill();
            } else if (z.type === 'slow') {
                ctx.strokeStyle = color; ctx.lineWidth = 1.5;
                for (let row = -1; row <= 1; row++) {
                    ctx.beginPath();
                    for (let dx = -8; dx <= 8; dx++) { const sx = cx + dx, sy = cy + row * 4 + Math.sin(dx * 0.8) * 2; dx === -8 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy); }
                    ctx.stroke();
                }
            } else if (z.type === 'vortex') {
                ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
                for (let t = 0; t < Math.PI * 3; t += 0.2) { const r = t * 1.5; t === 0 ? ctx.moveTo(cx + r, cy) : ctx.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); }
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
        }

        // Zone particles
        for (let i = zoneParticles.length - 1; i >= 0; i--) {
            const p = zoneParticles[i];
            p.x += p.vx; p.y += p.vy; p.life -= p.decay;
            if (p.style === 'swirl') { p.vx += (Math.random() - 0.5) * 0.3; p.vy += (Math.random() - 0.5) * 0.3; }
            if (p.life <= 0) { zoneParticles.splice(i, 1); continue; }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.shadowBlur = 6; ctx.shadowColor = p.color;
            ctx.fillStyle = p.color + hexAlpha(p.life * 0.8); ctx.fill(); ctx.shadowBlur = 0;
        }

        // === Obstacles ===
        for (const obs of obstacles) {
            if (obs.type === 'bumper') {
                const flash = Math.max(0, 1 - (now - obs.hitTime) / 300);
                ctx.shadowBlur = 12 + flash * 25; ctx.shadowColor = '#ff9100';
                ctx.beginPath(); ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 145, 0, ${0.1 + flash * 0.35})`; ctx.fill();
                ctx.strokeStyle = `rgba(255, 170, 0, ${0.6 + flash * 0.4})`; ctx.lineWidth = 2.5 + flash * 2; ctx.stroke();
                const ip = 0.6 + Math.sin(now * 0.008) * 0.4;
                ctx.beginPath(); ctx.arc(obs.x, obs.y, obs.r * 0.5 * ip, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255, 220, 80, ${0.4 + flash * 0.5})`; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.beginPath(); ctx.arc(obs.x, obs.y, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 200, ${0.6 + flash * 0.4})`; ctx.fill();
                ctx.shadowBlur = 0;
            }
            if (obs.type === 'spinner') {
                ctx.save(); ctx.translate(obs.body.position.x, obs.body.position.y); ctx.rotate(obs.body.angle);
                const hw = obs.w / 2;
                ctx.shadowBlur = 10; ctx.shadowColor = '#d050ff'; ctx.fillStyle = '#d050ff';
                roundRect(ctx, -hw, -3, obs.w, 6, 3); ctx.fill();
                ctx.beginPath(); ctx.arc(-hw, 0, 4, 0, Math.PI * 2); ctx.fillStyle = '#e088ff'; ctx.fill();
                ctx.beginPath(); ctx.arc(hw, 0, 4, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fillStyle = '#e0aaff'; ctx.fill();
                ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
                ctx.shadowBlur = 0; ctx.restore();
            }
            if (obs.type === 'ramp') {
                ctx.save(); ctx.translate(obs.body.position.x, obs.body.position.y); ctx.rotate(obs.body.angle);
                ctx.shadowBlur = 8; ctx.shadowColor = '#00e676'; ctx.fillStyle = '#00e676';
                roundRect(ctx, -obs.w / 2, -obs.h / 2, obs.w, obs.h, 2.5); ctx.fill();
                ctx.strokeStyle = 'rgba(0,230,118,0.4)'; ctx.lineWidth = 1;
                const dir = obs.angle > 0 ? 1 : -1;
                for (let ci = -1; ci <= 1; ci++) { ctx.beginPath(); ctx.moveTo(ci * 14 - 3 * dir, -3); ctx.lineTo(ci * 14 + 3 * dir, 0); ctx.lineTo(ci * 14 - 3 * dir, 3); ctx.stroke(); }
                ctx.shadowBlur = 0; ctx.restore();
            }
            if (obs.type === 'launcher') {
                const flash = Math.max(0, 1 - (now - obs.hitTime) / 400);
                const pulse = 0.6 + Math.sin(now * 0.008) * 0.4;
                ctx.shadowBlur = 15 + flash * 25; ctx.shadowColor = '#ff1744';
                ctx.beginPath(); ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 23, 68, ${0.1 + flash * 0.4})`; ctx.fill();
                ctx.strokeStyle = `rgba(255, 23, 68, ${0.5 + flash * 0.5})`; ctx.lineWidth = 2.5 + flash * 2; ctx.stroke();
                ctx.beginPath(); ctx.arc(obs.x, obs.y, obs.r * 0.6 * pulse, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255,100,100,${0.4 + pulse * 0.3})`; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.fillStyle = `rgba(255,50,50,${0.7 + flash * 0.3})`;
                ctx.beginPath();
                ctx.moveTo(obs.x, obs.y - 7); ctx.lineTo(obs.x - 5, obs.y + 2); ctx.lineTo(obs.x - 2, obs.y + 2);
                ctx.lineTo(obs.x - 2, obs.y + 6); ctx.lineTo(obs.x + 2, obs.y + 6); ctx.lineTo(obs.x + 2, obs.y + 2);
                ctx.lineTo(obs.x + 5, obs.y + 2); ctx.closePath(); ctx.fill();
                ctx.shadowBlur = 0;
            }
        }

        // === Pins (colored per stage) ===
        const allBodies = Composite.allBodies(engine.world);
        for (const body of allBodies) {
            if (body.label === 'pin') {
                const py = body.position.y;
                let pinColor = '#00ffff';
                for (const stage of STAGES) {
                    if (py >= stage.yStart && py < stage.yEnd) { pinColor = stage.color; break; }
                }
                ctx.shadowBlur = 8; ctx.shadowColor = pinColor; ctx.fillStyle = pinColor;
                ctx.beginPath(); ctx.arc(body.position.x, body.position.y, PIN_RADIUS, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.shadowBlur = 0;

        // === Wormholes ===
        for (const wh of wormholes) {
            const flash = Math.max(0, 1 - (now - wh.hitTime) / 600);
            const pulse = 0.6 + Math.sin(now * 0.005 + wh.y * 0.01) * 0.4;
            const r = wh.r;
            const isEntry = wh.pairType === 'entry';

            // Outer glow ring
            ctx.shadowBlur = 20 + flash * 30; ctx.shadowColor = wh.color;
            ctx.beginPath(); ctx.arc(wh.x, wh.y, r + 2, 0, Math.PI * 2);
            ctx.strokeStyle = wh.color + hexAlpha(0.5 + flash * 0.5); ctx.lineWidth = 2.5 + flash * 2; ctx.stroke();

            // Dark center (black hole effect)
            const centerGrad = ctx.createRadialGradient(wh.x, wh.y, 0, wh.x, wh.y, r);
            centerGrad.addColorStop(0, '#000000');
            centerGrad.addColorStop(0.6, '#0a0a2e');
            centerGrad.addColorStop(1, wh.color + '30');
            ctx.beginPath(); ctx.arc(wh.x, wh.y, r, 0, Math.PI * 2);
            ctx.fillStyle = centerGrad; ctx.fill();

            // Spinning spiral
            ctx.strokeStyle = wh.color + hexAlpha(0.4 + pulse * 0.3); ctx.lineWidth = 1.5;
            const spiralOffset = now * 0.003 * (isEntry ? 1 : -1);
            for (let arm = 0; arm < 3; arm++) {
                ctx.beginPath();
                for (let t = 0; t < Math.PI * 2; t += 0.15) {
                    const sr = t * r / (Math.PI * 2);
                    const angle = t + spiralOffset + (arm * Math.PI * 2 / 3);
                    const sx = wh.x + Math.cos(angle) * sr;
                    const sy = wh.y + Math.sin(angle) * sr;
                    t === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
                }
                ctx.stroke();
            }

            // Inner bright dot
            ctx.beginPath(); ctx.arc(wh.x, wh.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = wh.color + hexAlpha(0.6 + pulse * 0.4); ctx.fill();

            // Label
            ctx.fillStyle = wh.color + hexAlpha(0.5 + flash * 0.3);
            ctx.font = '700 7px Orbitron, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(isEntry ? 'WARP' : 'EXIT', wh.x, wh.y + r + 12);
            ctx.shadowBlur = 0;
        }

        // === Wall bounce segments (glowing wall sections) ===
        for (const obs of obstacles) {
            if (obs.type !== 'wallbounce') continue;
            const flash = Math.max(0, 1 - (now - obs.hitTime) / 500);
            const pulse = 0.5 + Math.sin(now * 0.006) * 0.3;
            const yTop = obs.y - obs.h / 2;
            const yBot = obs.y + obs.h / 2;

            // Draw glowing wall segment
            const wpTop = getWallX(yTop);
            const wpBot = getWallX(yBot);
            const isRight = obs.side === 'right';

            ctx.shadowBlur = 15 + flash * 25; ctx.shadowColor = '#ffea00';
            ctx.strokeStyle = `rgba(255, 234, 0, ${0.5 + flash * 0.5 + pulse * 0.2})`;
            ctx.lineWidth = 5 + flash * 3;
            ctx.beginPath();
            if (isRight) {
                ctx.moveTo(wpTop.right - 5, yTop);
                ctx.lineTo(wpBot.right - 5, yBot);
            } else {
                ctx.moveTo(wpTop.left + 5, yTop);
                ctx.lineTo(wpBot.left + 5, yBot);
            }
            ctx.stroke();

            // Glow fill behind
            ctx.fillStyle = `rgba(255, 234, 0, ${0.05 + flash * 0.15 + pulse * 0.05})`;
            const cx = isRight ? wpTop.right - 20 : wpTop.left + 20;
            ctx.beginPath();
            ctx.ellipse(cx, obs.y, 15, obs.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();

            // Small arrows showing bounce direction
            const arrowX = isRight ? wpTop.right - 18 : wpTop.left + 18;
            const arrowDir = isRight ? -1 : 1;
            ctx.fillStyle = `rgba(255, 255, 200, ${0.4 + flash * 0.4 + pulse * 0.2})`;
            for (let ai = 0; ai < 3; ai++) {
                const ay = obs.y - 15 + ai * 15;
                ctx.beginPath();
                ctx.moveTo(arrowX + arrowDir * 6, ay);
                ctx.lineTo(arrowX, ay - 4);
                ctx.lineTo(arrowX, ay + 4);
                ctx.closePath(); ctx.fill();
            }
            ctx.shadowBlur = 0;
        }

        // === Rotating gates ===
        for (const gate of rotatingGates) {
            ctx.save();
            ctx.translate(gate.body.position.x, gate.body.position.y);
            ctx.rotate(gate.body.angle);
            const hw = gate.w / 2;
            const pulse = 0.6 + Math.sin(now * 0.004) * 0.4;

            ctx.shadowBlur = 12; ctx.shadowColor = '#ffea00';
            // Main bar
            ctx.fillStyle = `rgba(255, 234, 0, ${0.25 + pulse * 0.15})`;
            roundRect(ctx, -hw, -4, gate.w, 8, 4); ctx.fill();
            ctx.strokeStyle = `rgba(255, 234, 0, ${0.6 + pulse * 0.3})`; ctx.lineWidth = 1.5;
            roundRect(ctx, -hw, -4, gate.w, 8, 4); ctx.stroke();
            // Center pivot
            ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffea00'; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            // End caps
            ctx.beginPath(); ctx.arc(-hw + 4, 0, 4, 0, Math.PI * 2); ctx.fillStyle = '#ffea0088'; ctx.fill();
            ctx.beginPath(); ctx.arc(hw - 4, 0, 4, 0, Math.PI * 2); ctx.fill();

            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // === Finish line ===
        const finishWall = getWallX(FINISH_Y);
        const flL = finishWall.left + 5, flR = finishWall.right - 5;
        const fp = 0.6 + Math.sin(now * 0.004) * 0.4;
        ctx.shadowBlur = 18 * fp; ctx.shadowColor = '#ffff00';
        ctx.strokeStyle = `rgba(255,255,0,${0.6 + fp * 0.4})`; ctx.lineWidth = 4;
        ctx.setLineDash([10, 6]);
        ctx.beginPath(); ctx.moveTo(flL, FINISH_Y); ctx.lineTo(flR, FINISH_Y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffff00'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🏁', flL - 8, FINISH_Y + 5); ctx.fillText('🏁', flR + 8, FINISH_Y + 5);
        ctx.shadowBlur = 0;

        // === Balls ===
        for (const bi of balls) {
            const { x, y } = bi.body.position;
            if (!bi.finished) { bi.trail.push({ x, y }); if (bi.trail.length > 22) bi.trail.shift(); }
            for (let t = 0; t < bi.trail.length; t++) {
                const alpha = (t / bi.trail.length) * 0.4;
                const r = BALL_RADIUS * (t / bi.trail.length) * 0.6;
                ctx.beginPath(); ctx.arc(bi.trail[t].x, bi.trail[t].y, r, 0, Math.PI * 2);
                ctx.fillStyle = bi.color + hexAlpha(alpha); ctx.fill();
            }
            if (bi.finished && finishOrder.indexOf(bi) < winnerCount) {
                const pulse = 0.5 + Math.sin(now * 0.006) * 0.5;
                ctx.beginPath(); ctx.arc(x, y, BALL_RADIUS + 7 + pulse * 5, 0, Math.PI * 2);
                ctx.strokeStyle = bi.color + hexAlpha(0.3 + pulse * 0.4);
                ctx.lineWidth = 2.5; ctx.shadowBlur = 25; ctx.shadowColor = bi.color; ctx.stroke(); ctx.shadowBlur = 0;
            }
            ctx.shadowBlur = 18; ctx.shadowColor = bi.color; ctx.fillStyle = bi.color;
            ctx.beginPath(); ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x, y, BALL_RADIUS * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.shadowBlur = 0;
            ctx.shadowBlur = 5; ctx.shadowColor = bi.color; ctx.fillStyle = bi.color;
            ctx.font = '700 9px Orbitron, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(bi.name, x, y - BALL_RADIUS - 6); ctx.shadowBlur = 0;
        }

        // Auto-scroll
        if (balls.length > 0 && !raceComplete) {
            const target = getCameraTarget();
            if (target) {
                const wrap = document.getElementById('canvas-wrap');
                const viewH = wrap.clientHeight;
                wrap.scrollTop += (target.body.position.y - viewH * 0.45 - wrap.scrollTop) * 0.12;
            }
        }

        animFrameId = requestAnimationFrame(renderLoop);
    }

    // ===================== UTIL =====================

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    function hexAlpha(a) {
        const v = Math.round(Math.min(1, Math.max(0, a)) * 255);
        return v.toString(16).padStart(2, '0');
    }
})();
