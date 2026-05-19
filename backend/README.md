# Job Watch Alert Backend

This backend receives fresh job matches from the extension and sends selected
email and Telegram alerts.

## Run Locally

1. Copy `.env.example` to `.env`.
2. Fill the variables you want to use.
3. Start it:

```powershell
cd C:\Users\78var\jobwatch-extension\backend
node server.js
```

The local endpoint is:

```text
http://localhost:8787/alerts/notify
```

For local testing, set `APP_CONFIG.backendBaseUrl` in `config.js` to:

```js
backendBaseUrl: "http://localhost:8787",
```

For public users, deploy this backend to HTTPS and use the deployed URL instead.

## Email

Email uses SendGrid. Set:

```text
SENDGRID_API_KEY=...
ALERT_FROM_EMAIL=verified-sender@example.com
ALERT_FROM_NAME=Canada Job Watcher
```

`ALERT_FROM_EMAIL` must be a verified sender/domain in SendGrid.

## Telegram

Create a bot with Telegram BotFather, then set:

```text
TELEGRAM_BOT_TOKEN=...
```

The user needs to start a chat with your bot. Their Telegram chat ID goes into
the extension popup.

## Security

Never put email API keys or Telegram bot tokens in the browser extension. Keep
them only on this backend.

`ALERT_SHARED_SECRET` is optional. It can block random internet traffic, but do
not treat a secret embedded in a public extension as strong security.
