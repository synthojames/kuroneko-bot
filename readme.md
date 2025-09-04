# Birthday Discord Bot

A Discord bot that tracks user birthdays and sends automated celebration messages.

## Features
- User birthday registration
- Automatic daily birthday checking
- Server-specific configuration
- SQLite database storage
- Duplicate message prevention

## Setup
1. Clone repository
2. Install dependencies: `npm install`
3. Create `.env` file with your Discord credentials
4. Run: `npm start`

## Environment Variables
- `DISCORD_TOKEN`: Your Discord bot token
- `CLIENT_ID`: Your Discord application client ID
- `NODE_ENV`: Set to 'production' for deployment