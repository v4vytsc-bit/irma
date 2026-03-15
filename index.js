const mineflayer = require('mineflayer')
const pvp = require('mineflayer-pvp').plugin
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalFollow, GoalBlock } = goals
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

let death = 0, pvpc = 0;
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

    // Load Plugins
    bot.loadPlugin(cmd);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        
        // Pathfinding Tweaks
        defaultMove.canDig = false; 
        defaultMove.allowParkour = true;
        bot.pathfinder.setMovements(defaultMove);
        
        console.log("Bot spawned and pathfinder movements set.");
    });

    // --- CHAT COMMANDS ---
    bot.on('chat', (sender, message) => {
        if (sender === bot.username) return;
        const target = bot.players[sender]?.entity;

        // FOLLOW COMMAND
        if (message === `follow ${bot.username}`) {
            if (!target) return bot.chat("I can't see you!");
            bot.chat(`I am following you, ${sender}!`);
            guardPos = null; // Clear guard position
            bot.pvp.stop();  // Stop fighting to move
            bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
        }

        // GUARD COMMAND
        if (message === `guard ${bot.username}`) {
            if (!target) return bot.chat("I can't see you!");
            bot.chat(`Guarding this spot, ${sender}.`);
            guardPos = target.position.clone();
            bot.pathfinder.setGoal(new GoalBlock(guardPos.x, guardPos.y, guardPos.z));
        }

        // FIGHT COMMAND
        if (message === `fight me ${bot.username}`) {
            if (!target) return bot.chat("Come closer if you want to fight!");
            pvpc++;
            bot.chat("En garde!");
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

    // GUARD & PATHFINDING LOGIC
    bot.on('physicsTick', () => {
        // If guarding and an enemy is nearby, prioritize PVP
        if (guardPos) {
            const filter = e => (e.type === 'mob' || e.type === 'player') && 
                                 e.position.distanceTo(bot.entity.position) < 16 &&
                                 e.username !== bot.username;
            
            const entity = bot.nearestEntity(filter);
            if (entity && !bot.pvp.target) {
                bot.pvp.attack(entity);
            } 

            // If we have moved too far from our guard post during a fight, go back
            if (!bot.pvp.target && bot.entity.position.distanceTo(guardPos) > 2) {
                bot.pathfinder.setGoal(new GoalBlock(guardPos.x, guardPos.y, guardPos.z));
            }
        }
    });

    bot.on('death', () => {
        death++;
        guardPos = null;
        bot.chat("I'll be back.");
    });

    bot.on('end', () => setTimeout(createBotInstance, 30000));
}

// DASHBOARD
const app = express();
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; text-align:center;">
            <h1>🤖 ${username} Status</h1>
            <div style="font-size: 1.5em; margin: 20px;">
                <p>⚔️ Fights: ${pvpc} | 💀 Deaths: ${death}</p>
                <p>📍 Mode: ${guardPos ? 'Guarding Area' : 'Idle/Following'}</p>
            </div>
            <script>setTimeout(() => location.reload(), 5000);</script>
        </body>
    `);
});
app.listen(webPort, () => createBotInstance());
