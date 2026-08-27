const fs = require('fs');
const path = require('path');

const protoPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@liamcottle',
  'rustplus.js',
  'rustplus.proto',
);
const rustplusPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@liamcottle',
  'rustplus.js',
  'rustplus.js',
);
const teamMemberPattern = /message AppTeamInfo \{[\s\S]*?\n\tmessage Member \{[\s\S]*?\n\t\}/;
const storageItemPattern = /message AppEntityPayload \{[\s\S]*?\n\tmessage Item \{[\s\S]*?\n\t\}/;
const appInfoPattern = /message AppInfo \{[\s\S]*?\n\}/;

if (!fs.existsSync(protoPath) || !fs.existsSync(rustplusPath)) process.exit(0);

const source = fs.readFileSync(protoPath, 'utf8');
const patched = source
  .replace(teamMemberPattern, (member) =>
    member
      .replace(/required uint64 leaderSteamId = 1;/, 'optional uint64 leaderSteamId = 1;')
      .replace(/required float x = 3;/, 'optional float x = 3;')
      .replace(/required float y = 4;/, 'optional float y = 4;')
      .replace(/required bool isOnline = 5;/, 'optional bool isOnline = 5;')
      .replace(/required uint32 spawnTime = 6;/, 'optional uint32 spawnTime = 6;')
      .replace(/required bool isAlive = 7;/, 'optional bool isAlive = 7;')
      .replace(/required uint32 deathTime = 8;/, 'optional uint32 deathTime = 8;'),
  )
  .replace(storageItemPattern, (item) =>
    item.replace(/required bool itemIsBlueprint = 3;/, 'optional bool itemIsBlueprint = 3;'),
  )
  .replace(/(message Note \{\s*)required int32 type = 2;/, '$1optional int32 type = 2;')
  .replace(appInfoPattern, (info) =>
    info
      .replace(/required string name = 1;/, 'optional string name = 1;')
      .replace(/required string headerImage = 2;/, 'optional string headerImage = 2;')
      .replace(/required string url = 3;/, 'optional string url = 3;')
      .replace(/required string map = 4;/, 'optional string map = 4;')
      .replace(/required uint32 mapSize = 5;/, 'optional uint32 mapSize = 5;')
      .replace(/required uint32 wipeTime = 6;/, 'optional uint32 wipeTime = 6;')
      .replace(/required uint32 players = 7;/, 'optional uint32 players = 7;')
      .replace(/required uint32 maxPlayers = 8;/, 'optional uint32 maxPlayers = 8;')
      .replace(/required uint32 queuedPlayers = 9;/, 'optional uint32 queuedPlayers = 9;'),
  );

if (
  !/message AppTeamInfo \{\s*optional uint64 leaderSteamId = 1;[\s\S]*?optional bool isOnline = 5;/.test(
    patched,
  )
) {
  throw new Error('Unable to patch AppTeamInfo fields.');
}
if (
  !/message AppEntityPayload \{[\s\S]*?message Item \{[\s\S]*?optional bool itemIsBlueprint = 3;/.test(
    patched,
  )
) {
  throw new Error('Unable to patch AppEntityPayload.Item.itemIsBlueprint.');
}
if (!/message AppInfo \{[\s\S]*?optional uint32 queuedPlayers = 9;/.test(patched)) {
  throw new Error('Unable to patch AppInfo.queuedPlayers.');
}

fs.writeFileSync(protoPath, patched);

const rustplusSource = fs.readFileSync(rustplusPath, 'utf8');
const decodedMessage = `                // decode received message\n                var message = this.AppMessage.decode(data);`;
const protectedDecode = `                // Decode errors can occur when a Rust server sends a newer optional field set.\n                var message;\n                try {\n                    message = this.AppMessage.decode(data);\n                } catch (error) {\n                    this.emit('error', error);\n                    return;\n                }`;
const patchedRustplus = rustplusSource
  .replace(decodedMessage, protectedDecode)
  .replace("this.emit('message', this.AppMessage.decode(data));", "this.emit('message', message);");

if (!patchedRustplus.includes("this.emit('error', error);")) {
  throw new Error('Unable to guard Rust+ protobuf decoding.');
}
if (patchedRustplus.includes("this.emit('message', this.AppMessage.decode(data));")) {
  throw new Error('Unable to remove duplicate Rust+ protobuf decoding.');
}

fs.writeFileSync(rustplusPath, patchedRustplus);
