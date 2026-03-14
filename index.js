const mineflayer = require('mineflayer')
const pvp = require('mineflayer-pvp').plugin
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalFollow, GoalBlock } = goals // Added GoalFollow here
const armorManager = require('mineflayer-armor-manager')
const cmd = require('mineflayer-cmd').plugin
const express = require('express')
const fs = require('fs');

// 1. CONFIG LOAD
let rawdata = fs.readFileSync('config.json');
let data = JSON.parse(rawdata);
const host = data["ip"];
const username = data["name"];
const webPort = process.env.PORT || 3000;

let death = 0, simp = 0, popularity = 0, pvpc = 0;
let guardPos = null;
let bot;

function createBotInstance() {
    bot = mineflayer.createBot({
        host: host,
        port: data["port"],
        username: username,
        version: data["version"] || false,
        viewDistance: "tiny"
    });

    bot.loadPlugin(cmd);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(pathfinder);

    bot.on('inject_allowed', () => { bot.physics.yieldInterval = 20; });

    bot.on('spawn', () => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
    });

    // --- CHAT COMMANDS ---
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        const target = bot.players[username]?.entity;

        // FOLLOW COMMAND
        if (message === `follow ${bot.username}`) {
            if (!target) return bot.chat("I can't see you!");
            bot.chat(`I am following you, ${username}!`);
            guardPos = null; // Stop guarding to follow
            bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
        }

        // GUARD COMMAND
        if (message === `guard ${bot.username}`) {
            if (!target) return bot.chat("I can't see you!");
            bot.chat(`Guarding this spot, ${username}.`);
            guardPos = target.position.clone();
            bot.pathfinder.setGoal(new GoalBlock(guardPos.x, guardPos.y, guardPos.z));
        }

        // FIGHT COMMAND
        if (message === `fight me ${bot.username}`) {
            if (!target) return bot.chat("Come closer if you want to fight!");
            pvpc++;
            bot.pvp.attack(target);
        }

        // STOP COMMAND
        if (message === `stop`) {
            bot.chat('Stopping all movement and combat.');
            guardPos = null;
            bot.pvp.stop();
            bot.pathfinder.setGoal(null);
        }
    });

    // GUARD COMBAT LOGIC
    bot.on('physicTick', () => {
        if (!guardPos || bot.pvp.target) return;
        const filter = e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 16;
        const entity = bot.nearestEntity(filter);
        if (entity) bot.pvp.attack(entity);
    });

    bot.on('end', () => setTimeout(createBotInstance, 30000));
}

// DASHBOARD
const app = express();
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; text-align:center;">
            <h1>🤖 ${username} Online</h1>
            <p>Fights: ${pvpc} | Deaths: ${death}</p>
            <p>Current Goal: ${guardPos ? 'Guarding Area' : 'Idle/Following'}</p>
            <script>setTimeout(() => location.reload(), 10000);</script>
        </body>
    `);
});
app.listen(webPort, () => createBotInstance());
