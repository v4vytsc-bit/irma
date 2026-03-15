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
let reconnectTimer = 0; // Tracks the 23s countdown
const startTime = Date.now();

function createBotInstance() {
    // Cleanup previous instance to prevent memory leaks
    if (bot) {
        bot.removeAllListeners();
    }

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
        reconnectTimer = 0; // Reset timer on successful login
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        defaultMove.canDig = false; 
        defaultMove.allowParkour = true;
        bot.pathfinder.setMovements(defaultMove);
        console.log(`[${new Date().toLocaleTimeString()}] Bot spawned!`);
    });

    bot.on('chat', (sender, message) => {
        if (sender === bot.username) return;
        const target = bot.players[sender]?.entity;
        
        if (message === `follow ${bot.username}`) {
            if (!target) return;
            bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
        }
        
        if (message === `stop`) {
            bot.pvp.stop();
            bot.pathfinder.setGoal(null);
        }
    });

    bot.on('death', () => { death++; });

    // RECONNECT LOGIC (23 Seconds)
    bot.on('kicked', (reason) => console.log(`Kicked: ${reason}`));
    bot.on('error', (err) => console.log(`Error: ${err.code || err.message}`));
    
    bot.on('end', (reason) => {
        console.log(`Disconnected (${reason}). Reconnecting in 23s...`);
        reconnectTimer = 23;

        // Countdown for the Dashboard API
        const countdown = setInterval(() => {
            reconnectTimer--;
            if (reconnectTimer <= 0) clearInterval(countdown);
        }, 1000);
