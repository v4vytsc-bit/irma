const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const express = require('express')
const fs = require('fs')

// 1. LITE CONFIG
const config = JSON.parse(fs.readFileSync('config.json'));
const webPort = process.env.PORT || 3000;
let bot, reconnectTimer = 0, status = "OFFLINE";

function createBot() {
    if (bot) { bot.removeAllListeners(); try { bot.end(); } catch (e) {} }
    status = "CONNECTING...";
    
    bot = mineflayer.createBot({
        host: config.ip,
        port: config.port,
        username: config.name,
        version: config.version || false,
        viewDistance: "tiny"
    });

    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        status = "ONLINE";
        reconnectTimer = 0;
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        console.log("Joined.");
    });

    bot.on('end', () => {
        status = "OFFLINE";
        reconnectTimer = 23;
        const timer = setInterval(() => {
            if (--reconnectTimer <= 0) { clearInterval(timer); createBot(); }
        }, 1000);
    });

    bot.on('error', (err) => console.log("Error: " + err.message));
}

// 2. LITE SERVER
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
    body { background: #111; color: #eee; font-family: sans-serif; text-align: center; padding: 20px; }
    .card { background: #222; padding: 20px; border-radius: 10px; display: inline-block; width: 300px; border: 1px solid #444; }
    #st { color: #2dd4bf; font-weight: bold; }
    input { width: 80%; padding: 8px; margin: 10px 0; background: #000; border: 1px solid #444; color: #fff; }
    button { background: #2dd4bf; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 5px; }
</style></head><body>
    <div class="card">
        <h3>${config.name}</h3>
        <p>Status: <span id="st">...</span></p>
        <p id="lc">---</p>
        <input id="i" placeholder="Chat message...">
        <button onclick="send()">SEND</button>
        <button onclick="fetch('/c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({m:'/reconnect'})}) " style="background:#444; color:#fff">REJOIN</button>
    </div>
    <script>
        async function send() {
            const i = document.getElementById('i');
            await fetch('/c', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({m:i.value})});
            i.value = '';
        }
        setInterval(async () => {
            const r = await fetch('/h').then(res => res.json());
            document.getElementById('st').innerText = r.s === 'OFFLINE' ? 'OFFLINE ('+r.t+'s)' : r.s;
            if(r.p) document.getElementById('lc').innerText = Math.floor(r.p.x)+','+Math.floor(r.p.y)+','+Math.floor(r.p.z);
        }, 1000);
    </script>
</body></html>`));

app.listen(webPort, () => createBot());
