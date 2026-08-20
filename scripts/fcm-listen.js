const fs = require('fs');
const PushReceiverClient = require('@liamcottle/push-receiver/src/client');

const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const credentials = config.fcm_credentials;

if (!credentials) throw new Error('FCM credentials are missing. Register Rust+ first.');

const client = new PushReceiverClient(credentials.gcm.androidId, credentials.gcm.securityToken, []);
client.on('ON_DATA_RECEIVED', (data) => process.stdout.write(`${JSON.stringify(data)}\n`));
client.connect();
