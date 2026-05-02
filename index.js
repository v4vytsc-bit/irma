const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const express = require('express')
const fs = require('fs')
const https = require('https')

const config = JSON.parse(fs.readFileSync('config.json'));
let randomMessages = [];
try { randomMessages = JSON.parse(fs.readFileSync('messages.json')); } catch (e) { randomMessages = ["Hello!"]; }

const webPort = process.env.PORT || 3000;
let bot, reconnectTimer = 0, status = "OFFLINE", reconnectInterval, msgTimeout, cycleTimeout;
let logs = [];
let lastMessageTime = 0;

// UPDATED SETTINGS
let settings = {
    jumpInterval: 10,
    sneakInterval: 15,
    reconnectDelay: 23,
    autoCycle: false, // NEW: Toggle for auto disconnect
    onlineTime: 30    // NEW: Minutes to stay online
};
let jumpTimer, sneakTimer;

function addLog(msg) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logs.push(`[${time}] ${msg}`);
    if (logs.length > 12) logs.shift();
}

function startActions() {
    if (jumpTimer) clearInterval(jumpTimer);
    if (sneakTimer) clearInterval(sneakTimer);
    if (cycleTimeout) clearTimeout(cycleTimeout);

    // Jump & Sneak
    jumpTimer = setInterval(() => {
        if (status === "ONLINE" && bot?.entity) {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 500);
        }
    }, settings.jumpInterval * 1000);

    sneakTimer = setInterval(() => {
        if (status === "ONLINE" && bot?.entity) {
            bot.setControlState('sneak', true);
            setTimeout(() => bot.setControlState('sneak', false), 1000);
        }
    }, settings.sneakInterval * 1000);

    // NEW: Auto-Disconnect Logic
    if (settings.autoCycle) {
        cycleTimeout = setTimeout(() => {
            if (status === "ONLINE") {
                addLog(`Auto-Cycle: Disconnecting for ${settings.reconnectDelay}s...`);
                bot.quit(); 
            }
        }, settings.onlineTime * 60000);
    }
}

function createBot() {
    if (bot) { bot.removeAllListeners(); try { bot.end(); } catch (e) {} }
    status = "CONNECTING...";
    bot = mineflayer.createBot({
        host: config.ip, port: parseInt(config.port),
        username: config.name, version: config.version || false,
        viewDistance: "tiny"
    });

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);

    bot.on('spawn', () => {
        status = "ONLINE";
        reconnectTimer = 0;
        clearInterval(reconnectInterval);
        addLog("Bot Online.");
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        startActions();
    });

    bot.on('end', () => {
        if (status === "RECONNECTING") return;
        status = "OFFLINE";
        reconnectTimer = settings.reconnectDelay;
        addLog(`Waiting ${reconnectTimer}s to rejoin...`);
        clearInterval(reconnectInterval);
        reconnectInterval = setInterval(() => {
            reconnectTimer--;
            if (reconnectTimer <= 0) { clearInterval(reconnectInterval); createBot(); }
        }, 1000);
    });
}

const app = express();
app.use(express.json());

app.get('/h', (req, res) => res.json({ s: status, t: reconnectTimer, l: logs, set: settings }));

app.post('/set', (req, res) => {
    settings = { ...settings, ...req.body };
    if (status === "ONLINE") startActions();
    res.sendStatus(200);
});

app.post('/reconnect', (req, res) => {
    addLog("Manual Rejoin...");
    status = "RECONNECTING";
    createBot();
    res.sendStatus(200);
});

app.post('/c', (req, res) => {
    const now = Date.now();
    if (now - lastMessageTime < 60000) return res.status(429).send("Cooldown: 60s");
    if (bot?.entity) bot.chat(req.body.m);
    lastMessageTime = now;
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { background: #0c0c0c; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; padding: 15px; }
    .card { background: #161616; padding: 20px; border-radius: 12px; width: 100%; max-width: 360px; border: 1px solid #333; }
    #st { color: #2dd4bf; font-weight: bold; }
    #log { background: #000; padding: 10px; border-radius: 6px; height: 120px; overflow-y: auto; font-family: monospace; font-size: 11px; margin: 12px 0; border: 1px solid #222; color: #4ade80; }
    .input-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px; background: #222; padding: 10px; border-radius: 8px; }
    .set-item { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #bbb; }
    .set-item input[type="number"] { width: 50px; background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; text-align: center; }
    button { border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
    .btn-main { background: #2dd4bf; color: #000; flex-grow: 1; }
    .btn-reconnect { background: #3b82f6; color: #fff; width: 100%; margin-top: 8px; }
    button:active { opacity: 0.7; transform: scale(0.98); }
</style></head><body>
    <div class="card">
        <h3 style="margin:0 0 10px 0;">${config.name} Dashboard</h3>
        <p style="font-size:13px;">Status: <span id="st">...</span></p>
        
        <div class="input-group">
            <div class="set-item">Jump Every (s): <input type="number" id="sj" value="${settings.jumpInterval}"></div>
            <div class="set-item">Sneak Every (s): <input type="number" id="ss" value="${settings.sneakInterval}"></div>
            <div class="set-item">Reconnect Delay (s): <input type="number" id="sr" value="${settings.reconnectDelay}"></div>
            <div class="set-item">
                Auto-Cycle (Rejoin): 
                <input type="checkbox" id="ac" ${settings.autoCycle ? 'checked' : ''}>
            </div>
            <div class="set-item">Stay Online (min): <input type="number" id="ot" value="${settings.onlineTime}"></div>
            <button style="background:#444; color:#fff; font-size:11px;" id="svBtn" onclick="updateSettings()">SAVE SETTINGS</button>
        </div>

        <div id="log"></div>
        <div style="display:flex; gap:5px;">
            <input id="i" style="background:#222; border:1px solid #444; color:#fff; padding:8px; border-radius:6px; flex-grow:1;" placeholder="Chat...">
            <button class="btn-main" onclick="send()">SEND</button>
        </div>
        <button class="btn-reconnect" onclick="reconnect()">FORCE REJOIN</button>
    </div>
    <script>
        async function updateSettings() {
            const btn = document.getElementById('svBtn');
            const body = { 
                jumpInterval: parseInt(document.getElementById('sj').value),
                sneakInterval: parseInt(document.getElementById('ss').value),
                reconnectDelay: parseInt(document.getElementById('sr').value),
                autoCycle: document.getElementById('ac').checked,
                onlineTime: parseInt(document.getElementById('ot').value)
            };
            await fetch('/set', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
            btn.innerText = "SAVED!";
            setTimeout(() => { btn.innerText = "SAVE SETTINGS"; }, 2000);
        }
        
        async function reconnect() {
            await fetch('/reconnect', {method:'POST'});
        }

        async function send() {
            const i = document.getElementById('i');
            const res = await fetch('/c', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({m:i.value})});
            if(res.status === 429) alert("60s Cooldown!");
            i.value = '';
        }

        setInterval(async () => {
            try {
                const r = await fetch('/h').then(res => res.json());
                const log = document.getElementById('log');
                document.getElementById('st').innerText = (r.s !== 'ONLINE') ? r.s + ' (' + r.t + 's)' : r.s;
                const scroll = log.scrollHeight - log.clientHeight <= log.scrollTop + 1;
                log.innerHTML = r.l.join('<br>');
                if(scroll) log.scrollTop = log.scrollHeight;
            } catch(e){}
        }, 1000);
    </script>
</body></html>`));

setInterval(() => {
    https.get('https://irma-345g.onrender.com', (res) => {}).on('error', (e) => {});
}, 180000);

app.listen(webPort, () => createBot());
