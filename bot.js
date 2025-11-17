//load env
require('dotenv').config();
// import discord.js
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
//require filesystem
const fs = require('fs');
//require cron
const cron = require('node-cron');
//require sqlite3 for birthdayDatabase
const Database = require('better-sqlite3');

// ============================================================================
// CONSTANTS
// ============================================================================

// Discord Embed Colors
const EMBED_COLORS = {
    SUCCESS: 0x00FF00,      // Green - for successful operations
    ERROR: 0xFF0000,        // Red - for errors and failures
    INFO: 0x00AE86,         // Teal - for informational messages
    WARNING: 0xFFAA00,      // Orange - for warnings
    BIRTHDAY: 0xFF69B4      // Pink - for birthday celebrations
};

// Date and Time Configuration
const DAYS_IN_EACH_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Includes leap year Feb 29
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAILY_BIRTHDAY_CHECK_SCHEDULE = '0 9 * * *'; // Cron format: Every day at 9:00 AM
const BIRTHDAY_CHECK_TIME_DISPLAY = 'Everyday at 9:00 AM JST'; // Human-readable format for users

// Database Configuration
const DATABASE_FILE_PATH = './birthdays.birthdayDatabase';

// Discord API Configuration
const DISCORD_API_VERSION = '10';

// ============================================================================
// BOT SETUP
// ============================================================================

// Create the bot :D
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Can see what servers its in
        GatewayIntentBits.GuildMessages, //Can see messages in server
        GatewayIntentBits.GuildMembers, // See server members
    ]
});

// ============================================================================
// DATABASE SETUP
// ============================================================================

let birthdayDatabase;

/**
 * Initializes the birthday database connection and creates necessary tables
 * Sets up foreign key constraints and ensures all tables exist
 */
function initializeDB() {
    console.log('Initializing the database');
    birthdayDatabase = new Database(DATABASE_FILE_PATH);
    birthdayDatabase.pragma('foreign_keys = ON');
    createTables();
    console.log('Database Initialized')
}
/**
 * Creates all necessary database tables if they don't exist
 * Tables: users, servers, birthday_messages
 * Also creates indexes for performance optimization
 */
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
    birthdayDatabase.exec(createUsersTable);
    birthdayDatabase.exec(createServersTable);
    birthdayDatabase.exec(createMessagesTable);

    //indexing for performance
    birthdayDatabase.exec('CREATE INDEX IF NOT EXISTS idx_users_birthday ON users(month, day)');
    birthdayDatabase.exec('CREATE INDEX IF NOT EXISTS idx_messages_date ON birthday_messages(sent_at)');

    console.log('Database tables created and/or verified');

}

// ============================================================================
// DATABASE FUNCTIONS - User Birthdays
// ============================================================================

/**
 * Retrieves a user's birthday information from the database
 * @param {string} userID - Discord user ID
 * @returns {Object|undefined} User birthday record or undefined if not found
 */
function getUserBirthday(userID){
    const stmt = birthdayDatabase.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(userID);
}

/**
 * Saves or updates a user's birthday in the database
 * @param {string} userID - Discord user ID
 * @param {string} username - Discord username
 * @param {number} month - Birth month (1-12)
 * @param {number} day - Birth day (1-31)
 * @returns {Object} Database execution result
 */
function saveUserBirthday(userID, username, month, day){
    const stmt = birthdayDatabase.prepare(`
        INSERT OR REPLACE INTO users (id, username, month, day, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    return stmt.run(userID, username, month, day);
}

/**
 * Removes a user's birthday from the database
 * @param {string} userID - Discord user ID
 * @returns {Object} Database execution result with changes count
 */
function removeUserBirthday(userID){
    const stmt = birthdayDatabase.prepare('DELETE FROM users WHERE id = ?');
    return stmt.run(userID);
}

/**
 * Gets all users who have a birthday on a specific date
 * @param {number} month - Month (1-12)
 * @param {number} day - Day (1-31)
 * @returns {Array} Array of user records with birthdays on that date
 */
function getUsersWithBirthday(month, day){
    const stmt = birthdayDatabase.prepare('SELECT * FROM users WHERE month = ? AND day = ?');
    return stmt.all(month,day);
}

/**
 * Retrieves all birthdays from the database, sorted by date
 * @returns {Array} Array of all user birthday records
 */
function getAllBirthdays(){
    const stmt = birthdayDatabase.prepare('SELECT * FROM users ORDER BY month, day');
    return stmt.all();
}
// ============================================================================
// DATABASE FUNCTIONS - Server Configuration
// ============================================================================

/**
 * Saves or updates a server's birthday notification configuration
 * @param {string} serverID - Discord server (guild) ID
 * @param {string} serverName - Name of the Discord server
 * @param {string} channelID - Channel ID where birthday messages will be sent
 * @param {string} roleID - Role ID to ping for birthday notifications
 * @returns {Object} Database execution result
 */
function saveServerConfig(serverID, serverName, channelID, roleID) {
    const stmt = birthdayDatabase.prepare(`
        INSERT OR REPLACE INTO servers (id, server_name, channel_id, role_id, updated_at)
        VALUES (?,?,?,?, CURRENT_TIMESTAMP)
        `);
        return stmt.run(serverID, serverName, channelID, roleID);
}

/**
 * Retrieves a server's birthday notification configuration
 * @param {string} serverID - Discord server (guild) ID
 * @returns {Object|undefined} Server configuration or undefined if not found
 */
function getServerConfig(serverID){
    const stmt = birthdayDatabase.prepare('select * FROM servers WHERE id = ?');
    return stmt.get(serverID);
}

/**
 * Gets all servers that have birthday notifications configured
 * @returns {Array} Array of all server configuration records
 */
function getAllServerConfigs() {
    const stmt = birthdayDatabase.prepare('SELECT * FROM servers');
    return stmt.all();
}

// ============================================================================
// DATABASE FUNCTIONS - Birthday Message Tracking
// ============================================================================

/**
 * Logs that a birthday message was sent to a user in a server
 * Used to prevent sending duplicate messages
 * @param {string} userID - Discord user ID
 * @param {string} serverID - Discord server (guild) ID
 * @returns {Object} Database execution result
 */
function logBirthdayMessage(userID, serverID){
    const stmt = birthdayDatabase.prepare(`
            INSERT INTO birthday_messages (user_id, server_id)
            VALUES (?, ?)
        `);
        return stmt.run(userID, serverID);
}

/**
 * Checks if a birthday message was already sent to a user in a server today
 * Prevents duplicate birthday messages on the same day
 * @param {string} userID - Discord user ID
 * @param {string} serverID - Discord server (guild) ID
 * @returns {boolean} True if message already sent today, false otherwise
 */
function alreadySentToday(userID, serverID) {
    // Extract just the date portion (YYYY-MM-DD) from ISO timestamp
    const todayIsoDate = new Date().toISOString().split('T')[0];
    const stmt = birthdayDatabase.prepare(`
            SELECT COUNT(*) as count
            FROM birthday_messages
            WHERE user_id = ? and server_id = ? AND DATE(sent_at) = ?

        `);
        const result = stmt.get(userID, serverID, todayIsoDate);
        return result.count > 0;

}

// ============================================================================
// DATE VALIDATION
// ============================================================================

/**
 * Parses and validates a date string in MM/DD format
 * Checks for valid month (1-12) and day (1-31) ranges
 * Also validates that the day is valid for the given month (e.g., no Feb 30)
 * Accounts for leap years by allowing Feb 29
 *
 * @param {string} dateString - Date in MM/DD format (e.g., "04/20" for April 20th)
 * @returns {Object} Result object with:
 *   - isValid {boolean}: Whether the date is valid
 *   - error {string}: Error message if invalid
 *   - month {number}: Parsed month (1-12) if valid
 *   - day {number}: Parsed day (1-31) if valid
 *   - format {string}: The format used ('MM/DD') if valid
 */
function parseAndValidateDate(dateString){
    dateString = dateString.trim();

    // Validate the pattern matches MM/DD or M/D format
    const datePattern = /^\d{1,2}\/\d{1,2}$/;
    if (!datePattern.test(dateString)) {
        return {
            isValid: false,
            error: "Please use the correct MM/DD format. For example, April 20th would be 04/20"
        };
    }

    // Split the date string and parse the parts
    const dateParts = dateString.split('/');
    const monthValue = parseInt(dateParts[0]);
    const dayValue = parseInt(dateParts[1]);

    // Confirm both parts are valid numbers
    if(isNaN(monthValue) || isNaN(dayValue)){
        return{
            isValid:false,
            error: "Please only use numbers."
        };
    }

    // Validate month and day ranges
    if(monthValue >= 1 && monthValue <= 12 && dayValue >= 1 && dayValue <= 31) {
        // Check if the day is valid for the given month
        // Uses Feb 29 to account for leap years
        if(dayValue > DAYS_IN_EACH_MONTH[monthValue - 1]){
            return{
                isValid: false,
                error: `Month ${monthValue} doesn't have ${dayValue} days! Please recheck and try again`
            }
        }
        return{
            isValid: true,
            month: monthValue,
            day: dayValue,
            format: 'MM/DD'
        };
    }

    return{
        isValid:false,
        error: 'Invalid date, please try again'
    };
}

// ============================================================================
// BIRTHDAY CHECKING AND CELEBRATION
// ============================================================================

/**
 * Checks for birthdays today and sends celebration messages to all configured servers
 * Called daily by cron schedule and on bot startup
 * Logs detailed information about the checking process
 */
async function checkBirthdays(){
    console.log("Checking birthdays");

    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1; // JavaScript months are 0-indexed, add 1 for human-readable format

    console.log(`Today's date is ${todayMonth}/${todayDay}`);

    try{
        // Get all users who have birthdays today
        const usersWithBirthdaysToday = getUsersWithBirthday(todayMonth, todayDay);

        if(usersWithBirthdaysToday.length > 0) {
            console.log(`There are ${usersWithBirthdaysToday.length} birthdays today` );

            // Get all servers that have birthday notifications configured
            const servers = getAllServerConfigs();
            console.log(`Found ${servers.length} configured servers in database`);
            console.log(`Bot is currently in ${client.guilds.cache.size} servers`);

            // Send birthday messages to each configured server
            for(const server of servers) {
                console.log(`Processing server: ${server.server_name} (ID: ${server.id})`);
                await celebrateBirthday(server.id, server, usersWithBirthdaysToday);
            }
        } else {
            console.log('No birthdays today.');
        }
    } catch (error) {
        console.error('Error checking birthdays', error);

    }
}

/**
 * Sends birthday celebration messages to a specific server
 * Validates that the server, channel, and role exist before sending
 * Sends a celebratory embed for each user with a birthday
 *
 * @param {string} serverID - Discord server (guild) ID
 * @param {Object} serverSettings - Server configuration from database
 * @param {Array} usersWithBirthdaysToday - Array of users celebrating birthdays
 */
async function celebrateBirthday(serverID, serverSettings, usersWithBirthdaysToday){
    try{
        // Get the Discord server from cache
        const guild = client.guilds.cache.get(serverID);
        if (!guild) {
            console.log(`⚠️  Server "${serverSettings.server_name}" (ID: ${serverID}) not found - bot may have been removed from this server`);
            return;
        }

        // Get the configured birthday channel
        const channel = guild.channels.cache.get(serverSettings.channel_id);
        if(!channel) {
            console.log(`⚠️  Channel ID ${serverSettings.channel_id} not found in ${guild.name} - channel may have been deleted`);
            return;
        }

        // Get the role to ping
        const role = guild.roles.cache.get(serverSettings.role_id);
        if (!role){
            console.log(`⚠️  Role ID ${serverSettings.role_id} not found in ${guild.name} - role may have been deleted`);
            return;
        }

        // Send a birthday message for each user
        for (const birthdayUser of usersWithBirthdaysToday){
            const birthdayEmbed = new EmbedBuilder()
                .setColor(EMBED_COLORS.BIRTHDAY)
                .setTitle('Happy birthday!')
                .setDescription(`It is ${birthdayUser.username}'s birthday today!`)
                .addFields(
                    {name: 'Birthday', value: `${birthdayUser.month}/${birthdayUser.day}`, inline: true},
                    {name: 'Celebration', value: `${role} Wish them a happy birthday!`, inline:true}
                )
                .setTimestamp();

            await channel.send({
                content: `<@&${serverSettings.role_id}>`,
                embeds: [birthdayEmbed]
            });

            console.log(`✅ Sent birthday message for ${birthdayUser.username} to ${guild.name}/#${channel.name}`);
        }

    } catch (error) {
        console.error(`Error sending messages to ${serverID}:`, error);
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if a user has administrator permissions in a server
 * @param {PermissionsBitField} memberPermissions - The member's permissions
 * @returns {boolean} True if user has Administrator or ManageGuild permissions
 */
function isServerAdmin(memberPermissions) {
    return memberPermissions?.has(PermissionFlagsBits.Administrator) ||
           memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

// ============================================================================
// SLASH COMMAND DEFINITIONS
// ============================================================================

// Define all slash commands for the bot
const commands = [
    new SlashCommandBuilder()
        .setName('hello')
        .setDescription('Bot says hello to you!'),

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

/**
 * Registers all slash commands with Discord
 * Called once when the bot starts up
 */
async function registerCommands() {
    const rest = new REST({version: DISCORD_API_VERSION}).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Starting to register commands');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands}
        )
        console.log('Successfully registered my commands');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// ============================================================================
// BOT EVENT HANDLERS
// ============================================================================

/**
 * Bot ready event - fires once when the bot successfully connects to Discord
 * Initializes database, registers commands, sets up cron schedule, and checks birthdays
 */
client.once('ready', async () => {
    try {
        console.log(`✅ I am online! Logged in as ${client.user.tag}`);

        // Initialize the database and create tables if needed
        console.log('📊 Initializing database...');
        initializeDB();

        // Register slash commands with Discord
        console.log('🔧 Registering commands...');
        await registerCommands();

        // Schedule daily birthday checks
        console.log('⏰ Setting up daily birthday check schedule...');
        cron.schedule(DAILY_BIRTHDAY_CHECK_SCHEDULE, () => {
            console.log('🎂 Running scheduled birthday check...');
            checkBirthdays().catch(error => {
                console.error('❌ Error in scheduled birthday check:', error);
            });
        })

        // Immediately check for birthdays on bot startup
        console.log('🎂 Checking for birthdays on startup...');
        await checkBirthdays();

        console.log('🚀 Bot is fully ready and operational!');
    } catch (error) {
        console.error('❌ Error during bot startup:', error);
    }
});

/**
 * Disconnect event - fires when the bot loses connection to Discord
 */
client.on('disconnect', () => {
    console.warn('⚠️  Bot disconnected from Discord');
});

/**
 * Reconnecting event - fires when the bot attempts to reconnect
 */
client.on('reconnecting', () => {
    console.log('🔄 Attempting to reconnect to Discord...');
});

/**
 * Interaction create event - handles all slash command interactions
 * Routes commands to their respective handlers
 */
client.on('interactionCreate', async interaction =>{
    if(!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName;

    // ========================================================================
    // HELLO COMMAND
    // ========================================================================
    if(commandName == 'hello') {
        const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.INFO)
            .setTitle('Hello!')
            .setDescription('I am the bot!')
            .setTimestamp()

            await interaction.reply({embeds: [embed]});
    }

    // ========================================================================
    // BIRTHDAY COMMAND
    // ========================================================================
    if(commandName == 'birthday') {
        const subcommand = interaction.options.getSubcommand();

        // ====================================================================
        // BIRTHDAY SETUP SUBCOMMAND
        // ====================================================================
        if(subcommand == 'setup'){
            // Ensure command is used in a guild
            if(!interaction.guildId){
                await interaction.reply({
                    content: 'This command can only be used in a server.',
                    ephemeral: true
                });
                return;
            }

            // Check for admin permissions
            if(!isServerAdmin(interaction.memberPermissions)){
                await interaction.reply({
                    content: 'You are not an administrator, and thus cannot set this up',
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

                    // Save configuration to database
                    saveServerConfig(serverID, serverName, channel.id, role.id);

                    const setupEmbed = new EmbedBuilder()
                        .setColor(EMBED_COLORS.SUCCESS)
                        .setTitle('Birthday Notifications configured')
                        .setDescription('Birthday notifications have been configured')
                        .addFields(
                            {name: 'Birthday Channel', value: `<#${channel.id}>`, inline:true},
                            {name: 'Role', value: `<@&${role.id}>`, inline:true},
                            {name: 'Next Check', value: BIRTHDAY_CHECK_TIME_DISPLAY, inline:false}
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

            // ====================================================================
            // BIRTHDAY ADD SUBCOMMAND
            // ====================================================================
            if(subcommand == 'add') {
                try{
                    const dateInput = interaction.options.getString('date');
                    const userID = interaction.user.id;
                    const username = interaction.user.username;

                    // Validate birthday date format
                    const dateResult = parseAndValidateDate(dateInput);

                    if(!dateResult.isValid) {
                        const errorEmbed = new EmbedBuilder()
                            .setColor(EMBED_COLORS.ERROR)
                            .setTitle('Date is invalid')
                            .setDescription(dateResult.error)
                            .addFields(
                            { name: 'Examples', value: '• 12/25 (December 25th)\n• 7/3 (July 3rd)\n• 04/20 (April 20th)' }
                            );
                        await interaction.reply({embeds: [errorEmbed], ephemeral: true});
                        return;
                    }

                    // Save birthday to database
                    saveUserBirthday(userID, username, dateResult.month, dateResult.day);

                    const successEmbed = new EmbedBuilder()
                        .setColor(EMBED_COLORS.SUCCESS)
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

            // ====================================================================
            // BIRTHDAY LIST SUBCOMMAND
            // ====================================================================
            if(subcommand == 'list') {
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server',
                        ephemeral: true
                    });
                    return;
                }

                // Check for admin permissions
                if(!isServerAdmin(interaction.memberPermissions)){
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
                        .setColor(EMBED_COLORS.INFO)
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

            // ====================================================================
            // BIRTHDAY CHECK SUBCOMMAND
            // ====================================================================
            if(subcommand == 'check'){
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server',
                        ephemeral: true
                    });
                    return;
                }

                // Check for admin permissions
                if(!isServerAdmin(interaction.memberPermissions)) {
                    await interaction.reply({
                        content: 'You are not an admin',
                        ephemeral: true
                    });
                    return;
                }
                await interaction.reply ('Checking for birthdays');
                await checkBirthdays();
            }

            // ====================================================================
            // BIRTHDAY SHOW SUBCOMMAND
            // ====================================================================
            if(subcommand == 'show') {
                try{
                    const userID = interaction.user.id;
                    const birthday = getUserBirthday(userID);

                    if(birthday){
                        const embed = new EmbedBuilder()
                            .setColor(EMBED_COLORS.INFO)
                            .setTitle('Your birthday')
                            .setDescription(`Your birthday is ${birthday.month}/${birthday.day}`)
                            .setTimestamp();

                        await interaction.reply({embeds: [embed]});
                    } else {
                        const embed = new EmbedBuilder()
                            .setColor(EMBED_COLORS.WARNING)
                            .setTitle('No Birthday found')
                            .setDescription('You may have not set your birthday')
                            .addFields(
                                { name: 'How to add your birthday', value: 'Use `/birthday add` followed by your date in MM/DD format' }
                            );
                        await interaction.reply({embeds: [embed], ephemeral: true});
                    }
                } catch (error) {
                    console.error('Error in retrieving your birthday:', error);
                    await interaction.reply({
                        content: 'We could not retrieve your birthday at the moment',
                        ephemeral: true
                        });
                }
            }

            // ====================================================================
            // BIRTHDAY REMOVE SUBCOMMAND
            // ====================================================================
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

            // ====================================================================
            // BIRTHDAY STATS SUBCOMMAND
            // ====================================================================
            if(subcommand == "stats") {
                // Ensure command is used in a guild
                if(!interaction.guildId){
                    await interaction.reply({
                        content: 'This command can only be used in a server',
                        ephemeral: true
                    });
                    return;
                }

                // Check for admin permissions
                if(!isServerAdmin(interaction.memberPermissions)) {
                    await interaction.reply({
                            content: 'You are not an admin',
                            ephemeral: true
                    });
                    return;
                }
                try{
                    const totalUsers = birthdayDatabase.prepare('SELECT COUNT(*) as count FROM users').get().count;

                    const monthStats = birthdayDatabase.prepare(`
                        SELECT month, COUNT(*) as count
                        FROM users
                        GROUP BY month
                        ORDER BY count DESC
                        LIMIT 3
                    `).all();

                    const recentUsers = birthdayDatabase.prepare(`
                        SELECT COUNT(*) as count
                        FROM users
                        WHERE DATE(created_at) >= DATE('now', '-30 days')
                    `).get().count;

                    const totalServers = birthdayDatabase.prepare('SELECT COUNT(*) as count FROM servers').get().count;

                    // Get all configured servers and check if bot is in them
                    const configuredServers = getAllServerConfigs();
                    const serverStatus = configuredServers.map(server => {
                        const guild = client.guilds.cache.get(server.id);
                        const status = guild ? '✅' : '❌';
                        return `${status} ${server.server_name}`;
                    }).join('\n') || 'No servers configured';

                    const topMonths = monthStats
                        .map(stat => `${MONTH_NAMES[stat.month - 1]}: ${stat.count}`)
                        .join('\n') || 'NO DATA';

                    const embed = new EmbedBuilder()
                        .setColor(EMBED_COLORS.INFO)
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

// ============================================================================
// SHUTDOWN HANDLER
// ============================================================================

/**
 * Graceful shutdown handler - closes database connection before exiting
 * Triggered by SIGINT (Ctrl+C)
 */
process.on('SIGINT', () =>{
    console.log('Database shutting down');
    if(birthdayDatabase) {
        birthdayDatabase.close();
        console.log('Database connection shut down');
    }
    process.exit(0);
});

// ============================================================================
// ERROR HANDLERS
// ============================================================================

/**
 * Handle unhandled promise rejections
 * Prevents the bot from crashing when async operations fail
 */
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

/**
 * Handle uncaught exceptions
 * Logs the error but allows the bot to continue running
 */
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});

/**
 * Handle Discord client errors
 * Prevents crashes from Discord API issues
 */
client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

/**
 * Handle Discord warnings
 */
client.on('warn', (warning) => {
    console.warn('⚠️  Discord warning:', warning);
});

/**
 * Handle Discord debug messages (optional, comment out if too verbose)
 */
// client.on('debug', (info) => {
//     console.log('🔍 Discord debug:', info);
// });

// ============================================================================
// BOT LOGIN
// ============================================================================

// Connect the bot to Discord
client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('✅ Successfully logged in to Discord');
    })
    .catch((error) => {
        console.error('❌ Failed to login to Discord:', error);
        process.exit(1);
    });