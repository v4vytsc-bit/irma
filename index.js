const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const express = require('express')
const fs = require('fs')

// 1. CONFIG & STATE
const config = JSON.parse(fs.readFileSync('config.json'));
const webPort = process.env.PORT || 3000;
let bot, reconnectTimer = 0, status = "OFFLINE", reconnectInterval;

function createBot() {
    // Clear any existing bot and listeners
    if (bot) {
        bot.removeAllListeners();
        try { bot.end(); } catch (e) {}
    }

    status = "CONNECTING...";
    console.log(`Connecting to ${config.ip}:${config.port}...`);

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
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        console.log("Bot spawned in the world.");
    });

    bot.on('error', (err) => {
        console.log("Connection Error: " + err.message);
        if (err.code === 'ETIMEDOUT') {
            status = "TIMEOUT";
        }
    });

    bot.on('end', () => {
        if (status !== "TIMEOUT") status = "OFFLINE";
        console.log("Disconnected. Retrying in 23s...");
        
        // Reset timer and start countdown
        reconnectTimer = 23;
        clearInterval(reconnectInterval);
        
        reconnectInterval = setInterval(() => {
            reconnectTimer--;
            if (reconnectTimer <= 0) {
                clearInterval(reconnectInterval);
                createBot();
            }
        }, 1000);
    });
}

// 2. EXPRESS DASHBOARD
const app = express();
app.use(express.json());

app.get('/h', (req, res) => res.json({
    s: status,
    t: reconnectTimer,
    p: bot?.entity?.position || null
}));

app.post('/c', (req, res) => {
    if (bot?.entity) bot.chat(req.body.m);
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { background: #111; color: #eee; font-family: 'Segoe UI', sans-serif; text-align: center; padding: 20px; }
    .card { background: #222; padding: 25px; border-radius: 12px; display: inline-block; width: 320px; border: 1px solid #333; box-shadow: 0 10px 20px rgba(0,0,0,0.5); }
    #st { color: #2dd4bf; font-weight: bold; text-transform: uppercase; }
    input { width: 85%; padding: 10px; margin: 15px 0; background: #000; border: 1px solid #444; color: #fff; border-radius: 5px; }
    button { background: #2dd4bf; border: none; padding: 12px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 8px; transition: 0.2s; }
    button:hover { opacity: 0.8; }
    .btn-secondary { background: #333; color: #fff; }
</style></head><body>
    <div class="card">
        <h2 style="margin-top:0">${config.name}</h2>
        <p>Status: <span id="st">...</span></p>
        <p>Pos: <code id="lc">---</code></p>
        <input id="i" placeholder="Type a message..." onkeypress="if(event.key==='Enter')send()">
        <button onclick="send()">SEND MESSAGE</button>
        <button class="btn-secondary" onclick="location.reload()">REFRESH UI</button>
    </div>
    <script>
        async function send() {
            const i = document.getElementById('i');
            if(!i.value) return;
            await fetch('/c', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({m:i.value})});
            i.value = '';
        }
        setInterval(async () => {
            try {
                const r = await fetch('/h').then(res => res.json());
                const stEl = document.getElementById('st');
                stEl.innerText = (r.s === 'OFFLINE' || r.s === 'TIMEOUT') ? r.s + ' (' + r.t + 's)' : r.s;
                stEl.style.color = r.s === 'ONLINE' ? '#2dd4bf' : '#fb7185';
                if(r.p) document.getElementById('lc').innerText = Math.floor(r.p.x) + ', ' + Math.floor(r.p.y) + ', ' + Math.floor(r.p.z);
            } catch(e) {}
        }, 1000);
    </script>
</body></html>`));

app.listen(webPort, () => {
    console.log(`Web Dashboard: http://localhost:${webPort}`);
    createBot();
});
