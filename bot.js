//load env
require('dotenv').config();
// import discord.js
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
//require filesystem
const fs = require('fs'); 
//require cron
const cron = require('node-cron');
//require sqlite3 for db
const Database = require('better-sqlite3');

//Creat the bot :D
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Can see what servers its in
        GatewayIntentBits.GuildMessages, //Can see messages in server
        GatewayIntentBits.GuildMembers, // See server members
    ]
});

//DATABASE SETUP
const DB_FILE = './birthdays.db';
let db;

//Initialize DB
function initializeDB() {
    console.log('Initializing the database');
    db = new Database(DB_FILE);
    db.pragma('foreign_keys = ON');
    createTables();
    console.log('Database Initialized')
}
//Create the DB tables
function createTables() {
    //USERS TABLE
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users(
            id TEXT PRIMARY KEY, -- Discord User ID
            username TEXT NOT NULL, -- Discord username
            month INTEGER NOT NULL, -- Birth month
            day INTEGER NOT NULL, -- BirthDATE
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            
        )
    `;

    //SERVERS TABLE
    const createServersTable = `
        CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY, -- Discord Server ID
            server_name TEXT, -- Server name
            channel_id TEXT NOT NULL, -- Birthday Channel ID
            role_id TEXT NOT NULL, -- Role to ping
            timezone TEXT DEFAULT 'PST', -- Server timezone
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    //Birthday messages log table
    const createMessagesTable = `
        CREATE TABLE IF NOT EXISTS birthday_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            server_id TEXT NOT NULL,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(server_id) REFERENCES servers(id)
        )
    `;

    //create the tables
    db.exec(createUsersTable);
    db.exec(createServersTable);
    db.exec(createMessagesTable);

    //indexing for performance
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_birthday ON users(month, day)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_date ON birthday_messages(sent_at)');

    console.log('Database tables created and/or verified');

}

//read from db old

//Get birthday
function getUserBirthday(userID){
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(userID);
}
//Save Birthday
function saveUserBirthday(userID, username, month, day){
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO users (id, username, month, day, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    return stmt.run(userID, username, month, day);   
}
//Remove Birthday
function removeUserBirthday(userID){
    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    return stmt.run(userID);
}
//Get todays birthdays
function getUsersWithBirthday(month, day){
    const stmt = db.prepare('SELECT * FROM users WHERE month = ? AND day = ?');
    return stmt.all(month,day);
}
function getAllBirthdays(){
    const stmt = db.prepare('SELECT * FROM users ORDER BY month, day');
    return stmt.all();
}
//Save Serve Configuration
function saveServerConfig(serverID, serverName, channelID, roleID) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO servers (id, server_name, channel_id, role_id, updated_at)
        VALUES (?,?,?,?, CURRENT_TIMESTAMP)
        `);
        return stmt.run(serverID, serverName, channelID, roleID);
}

//get a servers configuration
function getServerConfig(serverID){
    const stmt = db.prepare('select * FROM servers WHERE id = ?');
    return stmt.get(serverID);
}

//Get all servers that are configured
function getAllServerConfigs() {
    const stmt = db.prepare('SELECT * FROM servers');
    return stmt.all();
}

//log when sent
function logBirthdayMessage(userID, serverID){
    const stmt = db.prepare(`
            INSERT INTO birthday_messages (user_id, server_id)
            VALUES (?, ?)
        `);
        return stmt.run(userID, serverID);
}

//Already sent today?
function alreadySentToday(userID, serverID) {
    const today = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
            SELECT COUNT(*) as count
            FROM birthday_messages
            WHERE user_id = ? and server_id = ? AND DATE(sent_at) = ?
        
        `);
        const result = stmt.get(userID, serverID, today);
        return result.count > 0;

}

function parseAndValidateDate(dateString){
    dateString = dateString.trim();

    //validate the pattern
    const datePattern = /^\d{1,2}\/\d{1,2}$/;
    if (!datePattern.test(dateString)) {
        return {
            isValid: false,
            error: "Please use the correct MM/DD format. For example, April 20th would be 04/20"
        };
    }

    //break up the input to validate
    const parts = dateString.split('/');
    const first = parseInt(parts[0]);
    const second = parseInt(parts[1]);

    //confirm both are numbers

    if(isNaN(first) || isNaN(second)){
        return{
            isValid:false,
            error: "Please only use numbers."
        };
    }
    if(first >= 1 && first <= 12 && second >= 1 && second <= 31) {
        //now check if valid dates in month
        const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

        if(second > daysInMonth[first -1]){
            return{
                isValid: false,
                error: `${second} doesn't have ${first} days! Please recheck and try again`
            }
        }
        return{
            isValid: true,
            month: first,
            day: second,
            format: 'MM/DD'
        };
    }
    return{
        isValid:false,
        error: 'Invalid date, please try again'
    };
}

async function checkBirthdays(){
    console.log("Checking birthdays");
    
    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;

    console.log(`Today's date is ${todayMonth}/${todayDay}`);

    try{
        //get all users with bday today
        const birthdayPeople = getUsersWithBirthday(todayMonth, todayDay);

        if(birthdayPeople.length > 0) {
            console.log(`There are ${birthdayPeople.length} birthdays today` );

            //Get all servers
            const servers = getAllServerConfigs();
            console.log(`Found ${servers.length} configured servers in database`);
            console.log(`Bot is currently in ${client.guilds.cache.size} servers`);

            //send messages
            for(const server of servers) {
                console.log(`Processing server: ${server.server_name} (ID: ${server.id})`);
                await celebrateBirthday(server.id, server, birthdayPeople);
            }
        } else {
            console.log('No birthdays today.');
        }
    } catch (error) {
        console.error('Error checking birthdays', error);

    }
}

async function celebrateBirthday(serverID, serverSettings, birthdayPeople){
    try{
        //get the discord server
        const guild = client.guilds.cache.get(serverID);
        if (!guild) {
            console.log(`⚠️  Server "${serverSettings.server_name}" (ID: ${serverID}) not found - bot may have been removed from this server`);
            return;
        }
        const channel = guild.channels.cache.get(serverSettings.channel_id);
        if(!channel) {
            console.log(`⚠️  Channel ID ${serverSettings.channel_id} not found in ${guild.name} - channel may have been deleted`);
            return;
        }
        const role = guild.roles.cache.get(serverSettings.role_id);
        if (!role){
            console.log(`⚠️  Role ID ${serverSettings.role_id} not found in ${guild.name} - role may have been deleted`);
            return;
        }

        for (const person of birthdayPeople){
            const birthdayEmbed = new EmbedBuilder()
                .setColor(0xFF69B4)
                .setTitle('Happy birthday!')
                .setDescription(`It is ${person.username}'s birthday today!`)
                .addFields(
                    {name: 'Birthday', value: `${person.month}/${person.day}`, inline: true},
                    {name: 'Celebration', value: `${role} Wish them a happy birthday!`, inline:true}
                )
                .setThumbnail('https://cdn.discordapp.com/emojis/1234567890.png') // birthday cake emoji
                .setTimestamp();
            
            await channel.send({
                content: `<@&${serverSettings.role_id}>`,
                embeds: [birthdayEmbed]
            });

            console.log(`✅ Sent birthday message for ${person.username} to ${guild.name}/#${channel.name}`);
        }

    } catch (error) {
        console.error(`Error sending messages to ${serverID}:`, error);
    }
}

//define commands
const commands = [
    new SlashCommandBuilder()
        .setName('hello')
        .setDescription('Boy says hello to you!'),

    new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Manage Birthdays')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add your birthday')
                .addStringOption(option =>
                    option
                        .setName('date')
                        .setDescription('Your birthday in MM/DD format, so for April 20th, use 04/20')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription('Show your saved birthday')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove your birthday from the list')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Check all registered birthdays')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Force check todays birthdays')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View birthday statistics (ADMIN)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName(`setup`)
                .setDescription('Setup birthday notifications for this server (ADMIN)')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel where messages will be sent')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to ping when somebody has a birthday')
                        .setRequired(true)
                )
        )
];

async function registerCommands() {
    const rest = new REST({version: '10'}).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Starting to register commands');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands}
        )
        console.log('Succesfully registered my commands');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// On ready
client.once('ready', () => {
    console.log(`I am online! Logged in as ${client.user.tag}`);
    initializeDB();
    registerCommands();

    cron.schedule('0 9 * * *', () => {
        console.log('Checking daily birthdays!');
        checkBirthdays();
    })

    console.log('Checking for birthdays on startup!');
    checkBirthdays();
});

client.on('interactionCreate', async interaction =>{
    if(!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName;
    if(commandName == 'hello') {
        const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('Hello!')
            .setDescription('I am the bot!')
            .setTimestamp()

            await interaction.reply({embeds: [embed]});
    }

        if(commandName == 'birthday') {
            const subcommand = interaction.options.getSubcommand();

            if(subcommand == 'setup'){
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server.',
                        ephemeral: true
                    });
                    return;
                }

                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
                                interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if(!isAdmin){
                    await interaction.reply({
                        content: 'You are not an administrator, and thus can not set this up',
                        ephemeral: true
                    });
                    return
                }
                try{
                    const channel = interaction.options.getChannel('channel');
                    const role = interaction.options.getRole('role');

                    // Validate channel and role
                    if(!channel){
                        await interaction.reply({
                            content: 'Invalid channel selected. Please try again.',
                            ephemeral: true
                        });
                        return;
                    }
                    if(!role){
                        await interaction.reply({
                            content: 'Invalid role selected. Please try again.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Get the guild from the interaction (already cached)
                    const guild = interaction.guild;
                    if (!guild) {
                        await interaction.reply({
                            content: 'Unable to access server information. Please try again.',
                            ephemeral: true
                        });
                        return;
                    }

                    const fullChannel = await guild.channels.fetch(channel.id);

                    // Check bot permissions in the channel
                    const botMember = await guild.members.fetchMe();
                    const permissions = fullChannel.permissionsFor(botMember);

                    if (!permissions.has(PermissionFlagsBits.ViewChannel)) {
                        await interaction.reply({
                            content: '❌ I don\'t have permission to view that channel. Please give me the "View Channel" permission and try again.',
                            ephemeral: true
                        });
                        return;
                    }

                    if (!permissions.has(PermissionFlagsBits.SendMessages)) {
                        await interaction.reply({
                            content: '❌ I don\'t have permission to send messages in that channel. Please give me the "Send Messages" permission and try again.',
                            ephemeral: true
                        });
                        return;
                    }

                    if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
                        await interaction.reply({
                            content: '❌ I don\'t have permission to embed links in that channel. Please give me the "Embed Links" permission and try again.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Use guildId (always available) and get name from guild
                    const serverID = interaction.guildId;
                    const serverName = guild.name;

                    //save to db
                    saveServerConfig(serverID, serverName, channel.id, role.id);

                    const setupEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('Birthday Notifications configured')
                        .setDescription('Birthday notifications have been configured')
                        .addFields(
                            {name: 'Birthday Channel', value: `<#${channel.id}>`, inline:true},
                            {name: 'Role', value: `<@&${role.id}>`, inline:true},
                            {name: 'Next Check', value: 'Everyday at 9:00 AM JST', inline:false}
                        )
                        .setFooter({text: "Users can now add their birthday with /birthday add"})
                        .setTimestamp();
                    await interaction.reply({embeds: [setupEmbed]});

                    console.log(`Setup completed for server: ${serverName}`);

                } catch(error) {
                    console.error(`Error in setting up birthday notifications:`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: 'Sorry something went wrong, try again soon',
                            ephemeral:true
                        });
                    }
                }
            }

            if(subcommand == 'add') {
                try{
                    const dateInput = interaction.options.getString('date');
                    const userID = interaction.user.id;
                    const username = interaction.user.username;

                    //validate bday
                    const dateResult = parseAndValidateDate(dateInput);

                    if(!dateResult.isValid) {
                        const errorEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('Date is invalid')
                            .setDescription(dateResult.error)
                            .addFields(

                        
                            { name: 'Examples', value: '• 12/25 (December 25th)\n• 7/3 (July 3rd)\n• 04/20 (April 20th)' }
                            );
                        await interaction.reply({embeds: [errorEmbed], ephemeral: true});
                        return;
                    }

                    //save to db
                    saveUserBirthday(userID, username, dateResult.month, dateResult.day);
            
                    const successEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('Birthday added!')
                        .setDescription(`Your birthday is now saved as ${dateResult.month}/${dateResult.day}`)
                        .setFooter({text: `Detected format ${dateResult.format}`})
                        .setTimestamp()

                    await interaction.reply({embeds: [successEmbed]});
                } catch (error){
                    console.error('Error in adding birthday:', error);
                    await interaction.reply({
                        content: 'Something went wrong, try again',
                        ephemeral: true
                    });
                }
            }

            //list all bdays
            if(subcommand == 'list') {
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server',
                        ephemeral: true
                    });
                    return;
                }

                //admin check
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
                                interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if(!isAdmin){
                    await interaction.reply({
                        content: 'You are not an admin',
                        ephemeral: true
                    });
                    return;
                }
                try{
                    const birthdays = getAllBirthdays();
                    if (birthdays.length == 0) {
                        await interaction.reply({
                            content: 'No birthdays detected in DB',
                            ephemeral: true
                        });
                        return;
                    }
                    
                    const birthdayList = birthdays
                        .map(user => `**${user.username}**: ${user.month}/${user.day}`)
                        .join('\n');

                    const embed = new EmbedBuilder()
                        .setColor(0x00AE86)
                        .setTitle('All registered Birthdays')
                        .setDescription(birthdayList)
                        .setFooter({text: `Total: ${birthdays.length} birthdays`})
                        .setTimestamp();
                
                        await interaction.reply({embeds: [embed], ephemeral:true});
                } catch(error) {
                    console.error('Error in birthday list:', error);
                    await interaction.reply({
                        content: 'Something went wrong while getting the list',
                        ephemeral: true
                    });
                }
            }

            //manual check of birthdays
            if(subcommand == 'check'){
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server',
                        ephemeral: true
                    });
                    return;
                }

                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
                                interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if(!isAdmin) {
                    await interaction.reply({
                        content: 'You are not an admin',
                        ephemeral: true
                    });
                    return;
                }
                await interaction.reply ('Checking for birthdays');
                await checkBirthdays();
            }

            //check bday from dbase
            if(subcommand == 'show') {
                try{
                    const userID = interaction.user.id;
                    const birthday = getUserBirthday(userID);

                    if(birthday){
                        const embed = new EmbedBuilder()
                            .setColor(0x00AE86)
                            .setTitle('Your birthday')
                            .setDescription(`Your birthday is ${birthday.month}/${birthday.day}`)
                            .setTimestamp();

                        await interaction.reply({embeds: [embed]});
                    } else {
                        const embed = new EmbedBuilder()
                            .setColor(0xFFAA00)
                            .setTitle('No Birthday found')
                            .setDescription('You may have not set your birthday')
                            .addFields(
                                { name: 'How to add your birthday', value: 'Use `/birthday add` followed by your date in MM/DD format' }
                            );
                        await interaction.reply({embeds: [embed], ephemeral: true});
                    }
                } catch (error) {
                    console.error('Error in retrieiving your birthday:', error);
                    await interaction.reply({
                        content: 'We could not retrieve your birthday at the moment',
                        ephemeral: true
                        });
                }
            }

            //remove bday from database
            if(subcommand == 'remove'){
                try{
                    const userID = interaction.user.id;
                    const result = removeUserBirthday(userID);

                    if(result.changes > 0) {
                        await interaction.reply('Your birthday has been removed from the database');
                    } else {
                        await interaction.reply({
                            content: 'Your birthday already is not in the database',
                            ephemeral: true
                        });
                    }
                } catch (error) {
                    console.error('Error in removing birthday:', error);
                    await interaction.reply({
                        content: 'We had a problem removing your birthday. Try again',
                        ephemeral: true
                    });
                }
            }
            if(subcommand == "stats") {
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server',
                        ephemeral: true
                    });
                    return;
                }

                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
                                interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if(!isAdmin) {
                    await interaction.reply({
                            content: 'You are not an admin',
                            ephemeral: true
                    });
                    return;
                }
                try{
                    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

                    const monthStats = db.prepare(`
                        SELECT month, COUNT(*) as count
                        FROM users
                        GROUP BY month
                        ORDER BY count DESC
                        LIMIT 3
                    `).all();

                    const recentUsers = db.prepare(`
                        SELECT COUNT(*) as count
                        FROM users
                        WHERE DATE(created_at) >= DATE('now', '-30 days')
                    `).get().count;

                    const totalServers = db.prepare('SELECT COUNT(*) as count FROM servers').get().count;

                    // Get all configured servers and check if bot is in them
                    const configuredServers = getAllServerConfigs();
                    const serverStatus = configuredServers.map(server => {
                        const guild = client.guilds.cache.get(server.id);
                        const status = guild ? '✅' : '❌';
                        return `${status} ${server.server_name}`;
                    }).join('\n') || 'No servers configured';

                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                    const topMonths = monthStats
                        .map(stat => `${monthNames[stat.month - 1]}: ${stat.count}`)
                        .join('\n') || 'NO DATA';

                    const embed = new EmbedBuilder()
                        .setColor(0x00AE86)
                        .setTitle('Birthday statistics')
                        .addFields(
                            {name: 'Total users', value: totalUsers.toString(), inline: true},
                            {name: 'Configured servers', value: totalServers.toString(), inline: true},
                            {name: 'Recently registered', value: recentUsers.toString(), inline:true},
                            {name: 'Popular months', value: topMonths, inline: false},
                            {name: 'Server Status (✅ = bot present)', value: serverStatus, inline: false}
                        )
                        .setTimestamp();

                    await interaction.reply({embeds: [embed], ephemeral:true});
                } catch (error) {
                    console.error('Error detected', error);
                    await interaction.reply({
                        content: 'Something failed',
                        ephemeral: true
                    });
                }
            }
        }
    });

//shutdown db
process.on('SIGINT', () =>{
    console.log('db shutting down');
    if(db) {
        db.close();
        console.log('db connection shut down');
    }
    process.exit(0);
});



// Connect to discord
client.login(process.env.DISCORD_TOKEN);