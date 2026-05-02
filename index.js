const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const express = require('express')
const fs = require('fs')

// 1. CONFIG & STATE
const config = JSON.parse(fs.readFileSync('config.json'));
let randomMessages = [];
try { randomMessages = JSON.parse(fs.readFileSync('messages.json')); } catch (e) { randomMessages = ["Hello!"]; }

const webPort = process.env.PORT || 3000;
let bot, reconnectTimer = 0, status = "OFFLINE", reconnectInterval, msgTimeout;
let logs = [];
let lastMessageTime = 0;

// Movement state
let movementState = {
    enabled: config.movement?.enabled || false,
    circleRadius: config.movement?.circleRadius || 5,
    jumpInterval: config.movement?.jumpInterval || 3000,
    sneakInterval: config.movement?.sneakInterval || 5000,
    moveSpeed: config.movement?.moveSpeed || 0.1,
    centerPos: null,
    angle: 0,
    jumpTimer: null,
    sneakTimer: null,
    moveTimer: null,
    isSneaking: false
};

function addLog(msg) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    logs.push(`[${time}] ${msg}`);
    if (logs.length > 10) logs.shift();
}

// Logic to send chat with a 60s safety check
function safeChat(message) {
    const now = Date.now();
    const waitTime = 60000 - (now - lastMessageTime);

    if (waitTime > 0) {
        addLog(`Wait ${Math.ceil(waitTime / 1000)}s to chat.`);
        return false;
    }

    bot.chat(message);
    lastMessageTime = Date.now();
    return true;
}

function startRandomMessages() {
    if (msgTimeout) clearTimeout(msgTimeout);
    
    const nextMsgTime = Math.floor(Math.random() * (120000 - 60000 + 1) + 60000);
    
    msgTimeout = setTimeout(() => {
        if (status === "ONLINE" && bot?.entity) {
            const randomMsg = randomMessages[Math.floor(Math.random() * randomMessages.length)];
            const sent = safeChat(randomMsg);
            if (sent) addLog(`Random Msg: ${randomMsg}`);
        }
        startRandomMessages(); 
    }, nextMsgTime);
}

// Movement functions
function stopAllMovement() {
    if (movementState.jumpTimer) clearTimeout(movementState.jumpTimer);
    if (movementState.sneakTimer) clearTimeout(movementState.sneakTimer);
    if (movementState.moveTimer) clearInterval(movementState.moveTimer);
    movementState.jumpTimer = null;
    movementState.sneakTimer = null;
    movementState.moveTimer = null;
    if (bot?.entity) {
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        bot.setControlState('left', false);
        bot.setControlState('right', false);
        if (movementState.isSneaking) {
            bot.setControlState('sneak', false);
            movementState.isSneaking = false;
        }
    }
}

function startMovement() {
    if (!movementState.enabled || !bot?.entity) return;
    
    movementState.centerPos = { x: bot.entity.position.x, z: bot.entity.position.z };
    movementState.angle = 0;
    addLog("Movement started.");
    
    // Periodic jump
    function scheduleJump() {
        movementState.jumpTimer = setTimeout(() => {
            if (bot?.entity && movementState.enabled) {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 100);
            }
            scheduleJump();
        }, movementState.jumpInterval);
    }
    
    // Periodic sneak
    function scheduleSneak() {
        movementState.sneakTimer = setTimeout(() => {
            if (bot?.entity && movementState.enabled) {
                movementState.isSneaking = !movementState.isSneaking;
                bot.setControlState('sneak', movementState.isSneaking);
            }
            scheduleSneak();
        }, movementState.sneakInterval);
    }
    
    // Circular movement
    movementState.moveTimer = setInterval(() => {
        if (!bot?.entity || !movementState.enabled || !movementState.centerPos) return;
        
        movementState.angle += movementState.moveSpeed;
        if (movementState.angle > Math.PI * 2) movementState.angle = 0;
        
        const targetX = movementState.centerPos.x + Math.cos(movementState.angle) * movementState.circleRadius;
        const targetZ = movementState.centerPos.z + Math.sin(movementState.angle) * movementState.circleRadius;
        
        const dx = targetX - bot.entity.position.x;
        const dz = targetZ - bot.entity.position.z;
        
        bot.lookAt({ x: targetX, y: bot.entity.position.y + 1, z: targetZ });
        bot.setControlState('forward', true);
    }, 100);
    
    scheduleJump();
    scheduleSneak();
}

function createBot() {
    if (bot) { bot.removeAllListeners(); try { bot.end(); } catch (e) {} }
    if (msgTimeout) clearTimeout(msgTimeout);
    stopAllMovement();

    status = "CONNECTING...";
    bot = mineflayer.createBot({
        host: config.ip,
        port: parseInt(config.port),
        username: config.name,
        version: config.version || false,
        viewDistance: "tiny"
    });

    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        status = "ONLINE";
        reconnectTimer = 0;
        clearInterval(reconnectInterval);
        addLog("Bot Online.");
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        startRandomMessages();
        
        if (movementState.enabled) {
            startMovement();
        }
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        addLog(`${username}: ${message}`);
    });

    bot.on('error', (err) => {
        addLog(`Error: ${err.message}`);
        if (err.code === 'ETIMEDOUT') status = "TIMEOUT";
    });

    bot.on('end', () => {
        status = (status === "TIMEOUT") ? "TIMEOUT" : "OFFLINE";
        addLog("Disconnected. Rejoin in 23s.");
        stopAllMovement();
        reconnectTimer = 23;
        clearInterval(reconnectInterval);
        reconnectInterval = setInterval(() => {
            reconnectTimer--;
            if (reconnectTimer <= 0) { clearInterval(reconnectInterval); createBot(); }
        }, 1000);
    });
}

const app = express();
app.use(express.json());

app.get('/h', (req, res) => res.json({ 
    s: status, 
    t: reconnectTimer, 
    p: bot?.entity?.position || null, 
    l: logs,
    m: movementState
}));

app.post('/c', (req, res) => {
    if (bot?.entity) {
        const sent = safeChat(req.body.m);
        if (!sent) return res.status(429).send("Cooldown active");
    }
    res.sendStatus(200);
});

app.post('/movement', (req, res) => {
    const { enabled, circleRadius, jumpInterval, sneakInterval, moveSpeed } = req.body;
    
    if (enabled !== undefined) movementState.enabled = enabled;
    if (circleRadius !== undefined) movementState.circleRadius = Math.max(1, circleRadius);
    if (jumpInterval !== undefined) movementState.jumpInterval = Math.max(100, jumpInterval);
    if (sneakInterval !== undefined) movementState.sneakInterval = Math.max(100, sneakInterval);
    if (moveSpeed !== undefined) movementState.moveSpeed = Math.max(0.01, moveSpeed);
    
    stopAllMovement();
    if (movementState.enabled && bot?.entity) {
        startMovement();
        addLog("Movement updated.");
    }
    
    res.json(movementState);
});

app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { background: #111; color: #eee; font-family: sans-serif; display: flex; justify-content: center; padding: 20px; }
    .card { background: #222; padding: 20px; border-radius: 12px; width: 350px; border: 1px solid #333; }
    .card + .card { margin-top: 20px; }
    #st { color: #2dd4bf; font-weight: bold; }
    #log { background: #000; padding: 10px; border-radius: 5px; height: 120px; overflow-y: auto; text-align: left; font-size: 12px; margin: 10px 0; border: 1px solid #444; color: #aaa; }
    input { width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; background: #000; border: 1px solid #444; color: #fff; border-radius: 5px; }
    button { background: #2dd4bf; border: none; padding: 12px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
    .slider-group { margin-bottom: 15px; }
    .slider-group label { display: block; margin-bottom: 5px; font-size: 12px; color: #aaa; }
    input[type="range"] { width: 100%; }
    .toggle-btn { background: #444; margin-bottom: 10px; }
    .toggle-btn.active { background: #2dd4bf; color: #111; }
    .slider-value { display: inline-block; margin-left: 10px; color: #2dd4bf; font-weight: bold; }
</style></head><body>
    <div class="card">
        <h2 style="margin:0">${config.name}</h2>
        <p>Status: <span id="st">...</span></p>
        <div id="log"></div>
        <input id="i" placeholder="Message..." onkeypress="if(event.key==='Enter')send()">
        <button onclick="send()">SEND (60s CD)</button>
    </div>
    
    <div class="card">
        <h3 style="margin-top:0">Movement Controls</h3>
        <button id="movBtn" class="toggle-btn" onclick="toggleMovement()">Enable Movement</button>
        
        <div class="slider-group">
            <label>Circle Radius: <span id="radiusVal" class="slider-value">5</span> blocks</label>
            <input type="range" id="radius" min="1" max="20" value="5" oninput="updateMovement()">
        </div>
        
        <div class="slider-group">
            <label>Jump Interval: <span id="jumpVal" class="slider-value">3000</span> ms</label>
            <input type="range" id="jumpInt" min="500" max="10000" step="500" value="3000" oninput="updateMovement()">
        </div>
        
        <div class="slider-group">
            <label>Sneak Interval: <span id="sneakVal" class="slider-value">5000</span> ms</label>
            <input type="range" id="sneakInt" min="500" max="10000" step="500" value="5000" oninput="updateMovement()">
        </div>
        
        <div class="slider-group">
            <label>Move Speed: <span id="speedVal" class="slider-value">0.1</span></label>
            <input type="range" id="speed" min="0.01" max="0.5" step="0.01" value="0.1" oninput="updateMovement()">
        </div>
    </div>
    
    <script>
        let movementState = {};
        
        async function send() {
            const i = document.getElementById('i');
            if(!i.value) return;
            const res = await fetch('/c', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({m:i.value})});
            if (res.status === 429) alert("Please wait 60 seconds between messages!");
            i.value = '';
        }
        
        async function toggleMovement() {
            movementState.enabled = !movementState.enabled;
            await updateMovement();
        }
        
        async function updateMovement() {
            const radius = parseFloat(document.getElementById('radius').value);
            const jumpInt = parseInt(document.getElementById('jumpInt').value);
            const sneakInt = parseInt(document.getElementById('sneakInt').value);
            const speed = parseFloat(document.getElementById('speed').value);
            
            document.getElementById('radiusVal').textContent = radius;
            document.getElementById('jumpVal').textContent = jumpInt;
            document.getElementById('sneakVal').textContent = sneakInt;
            document.getElementById('speedVal').textContent = speed.toFixed(2);
            
            const res = await fetch('/movement', {
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({
                    enabled: movementState.enabled,
                    circleRadius: radius,
                    jumpInterval: jumpInt,
                    sneakInterval: sneakInt,
                    moveSpeed: speed
                })
            });
            
            movementState = await res.json();
            updateUI();
        }
        
        function updateUI() {
            const btn = document.getElementById('movBtn');
            if (movementState.enabled) {
                btn.classList.add('active');
                btn.textContent = 'Disable Movement';
            } else {
                btn.classList.remove('active');
                btn.textContent = 'Enable Movement';
            }
            
            document.getElementById('radius').value = movementState.circleRadius;
            document.getElementById('jumpInt').value = movementState.jumpInterval;
            document.getElementById('sneakInt').value = movementState.sneakInterval;
            document.getElementById('speed').value = movementState.moveSpeed;
            
            document.getElementById('radiusVal').textContent = movementState.circleRadius;
            document.getElementById('jumpVal').textContent = movementState.jumpInterval;
            document.getElementById('sneakVal').textContent = movementState.sneakInterval;
            document.getElementById('speedVal').textContent = movementState.moveSpeed.toFixed(2);
        }
        
        setInterval(async () => {
            const r = await fetch('/h').then(res => res.json());
            document.getElementById('st').innerText = (r.s.includes('OFFLINE') || r.s === 'TIMEOUT') ? r.s + ' (' + r.t + 's)' : r.s;
            document.getElementById('log').innerHTML = r.l.join('<br>');
            if (r.m) {
                movementState = r.m;
                updateUI();
            }
        }, 1000);
    </script>
</body></html>`));

app.listen(webPort, () => createBot());
