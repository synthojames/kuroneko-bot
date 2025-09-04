//load env
require('dotenv').config();
// import discord.js
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, embedBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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
        GatewayIntentBits.GuildMessages //Can see messages in server
    ]
});

//find the db
const DB_FILE = './birthdays.json';

//make the db if not existing
function initializeDB() {
    if(!fs.existsSync(DB_FILE)) {
        const emptyDB = {
            users: {}, //users in server
            servers: {} // servers
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(emptyDB, null, 2));
        console.log('No DB detected, so created one');
    }
}

//read from db
function readDB() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('DB Read ERROR:', error);
        console.log('Lets create a new DB');
        initializeDB();
        return { users: {}, servers: {}};
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data,null, 2));
        console.log('Data saved to DB');
    } catch (error) {
        console.error('Error writing to DB!', error);
    }
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
        const db = readDB();
        const birthdayPeople = [];
        for(const [userID, userData] of Object.entries(db.users)) {
            if(!userData.day || !userData.month) continue;

            if(userData.day == todayDay && userData.month == todayMonth) {
                birthdayPeople.push({
                    userID: userID,
                    username: userData.username,
                    day: userData.day,
                    month: userData.month
                });
            }
        }
        if(birthdayPeople.length > 0) {
            console.log(`There are ${birthdayPeople.length} birthdays today` );
            for(const [serverID, serverSettings] of Object.entries(db.servers)) {
                await celebrateBirthday(serverID, serverSettings, birthdayPeople);
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
            console.log(`${serverID} not found`);
            return;
        }
        const channel = guild.channels.cache.get(serverSettings.channelID);
        if(!channel) {
            console.log(`${serverSettings.channelID} not found in ${guild.name}`);
            return;
        }
        const role = guild.roles.cache.get(serverSettings.roleID);
        if (!role){
            console.log(`${serverSettings.roleID} in ${guild.name} not found`);
            return;
        }

        for (const person of birthdayPeople){
            const birthdayEmbed = new EmbedBuilder()
                .setColor(0xFF69B4)
                .setTitle('Happy brithday!')
                .setDescription(`It is ${person.username}'s birthday today!`)
                .addFields(
                    {name: 'Birthday', value: `${person.month}/${person.day}`, inline: true},
                    {name: 'Celebration', value: `${role} Wish them a happy birthday!`, inline:true}
                )
                .setThumbnail('https://cdn.discordapp.com/emojis/1234567890.png') // birthday cake emoji
                .setTimestamp();
            
            await channel.send({
                content: `<@&${serverSettings.roleID}>`,
                embeds: [birthdayEmbed]
            });

            console.log(`Sent birthday message for ${person.username} to ${guild.name}/#${channel.name}`);
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
                if(!interaction.member.permissions.has(PermissionFlagsBits.Administrator)){
                    await interaction.reply({
                        content: 'You are not an administrator, and thus can not set this up',
                        ephemeral: true
                    });
                    return
                }
                try{
                    const channel = interaction.options.getChannel('channel');
                    const role = interaction.options.getRole('role');
                    const serverID = interaction.guild.id;

                    const db = readDB();
                    if(!db.server) db.servers = {};

                    db.servers[serverID] = {
                        channelID: channel.id,
                        roleID: role.id,
                        serverName: interaction.guild.name
                    };
                    writeDB(db);

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

                    console.log(`Setup completed for server: ${interaction.guild.name}`);

                } catch(error) {
                    console.log(`Error in setting up birthday notifications:`, error);
                    await interaction.reply({
                        content: 'Sorry somethign went wrong, try again soon',
                        ephemeral:true
                    });
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
            

                    //read from db
                    const db = readDB();

                    //add to db
                    if(!db.users) db.users = {};
                    db.users[userID] = {
                        username: username,
                        month: dateResult.month,
                        day: dateResult.day
                    };

                    writeDB(db);
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
                //admin check
                if(!interaction.member.permissions.has(PermissionFlagsBits.Administrator)){
                    await interaction.reply({
                        content: 'You are not an admin',
                        ephemeral: true
                    });
                    return;
                }
                try{
                    const db = readDB();
                    const birthdays = Object.entries(db.users || {})
                        .filter(([userID,userData]) => userData.day && userData.month)
                        .map(([userID, userData]) => `${userData.username}: ${userData.month}/${userData.day}`)
                        .sort();
                
                    if(birthdays.length == 0){
                        await interaction.reply({
                            content: 'Sorry no birthdays have been registered',
                            ephemeral: true
                        });
                        return;
                    } 

                    const embed = new EmbedBuilder()
                        .setColor(0x00AE86)
                        .setTitle('All registered Birthdays')
                        .setDescription(birthdays.join('\n'))
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
                if(!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
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
                    const db = readDB();

                    if(db.users && db.users[userID]){
                        const birthday = db.users[userID];
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
                                { name: 'How to add your birthday', value: 'Use `/birthday add` followed by your date in DD/MM format' }
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
                    const db = readDB();

                    if(db.users && db.users[userID]) {
                        delete db.users[userID];
                        writeDB(db);
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
    }
});

// Connect to discord
client.login(process.env.DISCORD_TOKEN);