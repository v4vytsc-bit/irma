const mineflayer = require('mineflayer')
const pvp = require('mineflayer-pvp').plugin
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalFollow } = goals
const armorManager = require('mineflayer-armor-manager')
const cmd = require('mineflayer-cmd').plugin
const express = require('express')
const fs = require('fs');

// 1. CONFIG LOAD
let config = JSON.parse(fs.readFileSync('config.json'));
const host = config["ip"];
const username = config["name"];
const webPort = process.env.PORT || 3000;

let death = 0, pvpc = 0;
let bot;
let reconnectTimer = 0; 
let reconnectInterval;
const startTime = Date.now();

function createBotInstance() {
    // Clear existing timers and cleanup old bot
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectTimer = 0;

    if (bot) {
        bot.removeAllListeners();
        try { bot.quit(); } catch (e) {}
    }

    console.log(`[${new Date().toLocaleTimeString()}] Attempting to join ${host}...`);

    bot = mineflayer.createBot({
        host: host,
        port: config["port"],
        username: username,
        version: config["version"] || false,
        viewDistance: "tiny",
        connectTimeout: 30000
    });

    bot.loadPlugin(cmd);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        reconnectTimer = 0; 
        if (reconnectInterval) clearInterval(reconnectInterval);
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        defaultMove.canDig = false; 
        defaultMove.allowParkour = true;
        bot.pathfinder.setMovements(defaultMove);
        console.log("Bot joined and spawned!");
    });

    bot.on('chat', (sender, message) => {
        if (sender === bot.username) return;
        const target = bot.players[sender]?.entity;
        if (message === `follow ${bot.username}` && target) {
            bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
        }
        if (message === `stop`) {
            bot.pvp.stop();
            bot.pathfinder.setGoal(null);
        }
    });

    bot.on('death', () => { death++; });
    bot.on('kicked', (reason) => console.log(`Kicked: ${reason}`));
    bot.on('error', (err) => console.log(`Error: ${err.message}`));
    
    bot.on('end', (reason) => {
        console.log(`Disconnected: ${reason}. Auto-rejoining in 23s...`);
        startReconnectCountdown();
    });
}

function startReconnectCountdown() {
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectTimer = 23;
    reconnectInterval = setInterval(() => {
        reconnectTimer--;
        if (reconnectTimer <= 0) {
            clearInterval(reconnectInterval);
            createBotInstance();
        }
    }, 1000);
}

// 2. WEB SERVER & API
const app = express();

app.get('/health', (req, res) => {
    res.json({
        status: (bot && bot.entity) ? 'connected' : 'offline',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        coords: (bot && bot.entity) ? bot.entity.position : null,
        reconnectIn: reconnectTimer,
        stats: { fights: pvpc, deaths: death }
    });
});

// API endpoint to trigger restart
app.post('/restart', (req, res) => {
    console.log("Manual restart requested via Dashboard.");
    createBotInstance();
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Bot Control Panel</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .container { background: #1e293b; padding: 30px; border-radius: 15px; box-shadow: 0 0 30px rgba(45, 212, 191, 0.2); width: 350px; text-align: center; border: 1px solid #334155; }
            .stat-card { background: #0f172a; padding: 12px; margin: 10px 0; border-radius: 10px; border-left: 4px solid #2dd4bf; text-align: left; }
            .label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
            .value { font-size: 15px; font-weight: bold; color: #2dd4bf; margin-top: 4px; }
            .btn { background: #2dd4bf; color: #0f172a; border: none; padding: 12px; width: 100%; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 15px; transition: 0.3s; }
            .btn:hover { background: #5eead4; transform: translateY(-2px); }
            .btn:active { transform: translateY(0); }
            .pulse { animation: pulse 2s infinite; height: 10px; width: 10px; border-radius: 50%; display: inline-block; background: #4ade80; margin-right: 8px; }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        </style>
    </head>
    <body>
        <div class="container">
            <h2 style="margin-top:0;"><span class="pulse" id="dot"></span>${username}</h2>
            <div class="stat-card"><div class="label">System Status</div><div id="stat" class="value">INITIALIZING...</div></div>
            <div class="stat-card"><div class="label">Coordinates</div><div id="loc" class="value">---</div></div>
            <div class="stat-card"><div class="label">Session Uptime</div><div id="upt" class="value">0s</div></div>
            
            <button class="btn" onclick="restartBot()">REJOIN SERVER NOW</button>
            <p style="font-size: 11px; color: #64748b; margin-top: 15px;">Manual restart overrides the 23s timer.</p>
        </div>

        <script>
            async function restartBot() {
                const btn = document.querySelector('.btn');
                btn.innerText = "SENDING REQUEST...";
                btn.disabled = true;
                try {
                    await fetch('/restart', { method: 'POST' });
                    setTimeout(() => { btn.disabled = false; btn.innerText = "REJOIN SERVER NOW"; }, 2000);
                } catch(e) { alert("Failed to restart"); }
            }

            async function update() {
                try {
                    const r = await fetch('/health');
                    const d = await r.json();
                    const statEl = document.getElementById('stat');
                    const dotEl = document.getElementById('dot');
                    
                    if (d.status === 'connected') {
                        statEl.innerText = 'ONLINE';
                        statEl.style.color = '#2dd4bf';
                        dotEl.style.background = '#4ade80';
                    } else {
                        statEl.innerText = 'OFFLINE (RETRY: ' + d.reconnectIn + 's)';
                        statEl.style.color = '#f87171';
                        dotEl.style.background = '#f87171';
                    }
                    
                    document.getElementById('upt').innerText = d.uptime + 's';
                    if(d.coords) {
                        document.getElementById('loc').innerText = Math.floor(d.coords.x) + ', ' + Math.floor(d.coords.y) + ', ' + Math.floor(d.coords.z);
                    } else {
                        document.getElementById('loc').innerText = "---";
                    }
                } catch(e) {}
            }
            setInterval(update, 1000);
            update();
        </script>
    </body>
    </html>
    `);
});

// Prevent process exit on minor errors
process.on('unhandledRejection', (err) => console.log('Promise Rejected:', err));

app.listen(webPort, () => {
    console.log("Web control panel active on port " + webPort);
    createBotInstance();
});
