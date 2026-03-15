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
let config = JSON.parse(rawdata); 
const host = config["ip"];
const username = config["name"];
const webPort = process.env.PORT || 3000;

let death = 0, pvpc = 0;
let guardPos = null;
let bot;
const startTime = Date.now();

function createBotInstance() {
    bot = mineflayer.createBot({
        host: host,
        port: config["port"],
        username: username,
        version: config["version"] || false,
        viewDistance: "tiny"
    });

    bot.loadPlugin(cmd);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        defaultMove.canDig = false; 
        defaultMove.allowParkour = true;
        bot.pathfinder.setMovements(defaultMove);
        console.log("Bot spawned and pathfinder movements set.");
    });

    bot.on('chat', (sender, message) => {
        if (sender === bot.username) return;
        const target = bot.players[sender]?.entity;

        if (message === `follow ${bot.username}`) {
            if (!target) return bot.chat("I can't see you!");
            bot.chat(`I am following you, ${sender}!`);
            guardPos = null;
            bot.pvp.stop(); 
            bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
        }

        if (message === `guard ${bot.username}`) {
            if (!target) return bot.chat("I can't see you!");
            bot.chat(`Guarding this spot, ${sender}.`);
            guardPos = target.position.clone();
            bot.pathfinder.setGoal(new GoalBlock(guardPos.x, guardPos.y, guardPos.z));
        }

        if (message === `fight me ${bot.username}`) {
            if (!target) return bot.chat("Come closer if you want to fight!");
            pvpc++;
            bot.chat("En garde!");
            bot.pvp.attack(target);
        }

        if (message === `stop`) {
            bot.chat('Stopping all movement and combat.');
            guardPos = null;
            bot.pvp.stop();
            bot.pathfinder.setGoal(null);
        }
    });

    bot.on('physicsTick', () => {
        if (guardPos) {
            const filter = e => (e.type === 'mob' || e.type === 'player') && 
                                 e.position.distanceTo(bot.entity.position) < 16 &&
                                 e.username !== bot.username;
            
            const entity = bot.nearestEntity(filter);
            if (entity && !bot.pvp.target) {
                bot.pvp.attack(entity);
            } 

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

    bot.on('end', () => {
        console.log("Bot disconnected. Reconnecting in 30s...");
        setTimeout(createBotInstance, 30000);
    });
}

// --- DASHBOARD & API ---
const app = express();

app.get('/health', (req, res) => {
    res.json({
        status: bot && bot.entity ? 'connected' : 'reconnecting',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        coords: bot && bot.entity ? bot.entity.position : null,
        stats: { fights: pvpc, deaths: death }
    });
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${username} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; overflow: hidden; }
          .container { background: #1e293b; padding: 40px; border-radius: 20px; box-shadow: 0 0 50px rgba(45, 212, 191, 0.2); text-align: center; width: 400px; border: 1px solid #334155; }
          h1 { margin-bottom: 30px; font-size: 24px; color: #ccfbf1; display: flex; align-items: center; justify-content: center; gap: 10px; }
          .stat-card { background: #0f172a; padding: 15px; margin: 15px 0; border-radius: 12px; border-left: 5px solid #2dd4bf; text-align: left; }
          .label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 16px; font-weight: bold; color: #2dd4bf; margin-top: 5px; }
