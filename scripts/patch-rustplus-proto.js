const fs = require('fs');
const path = require('path');

const protoPath = path.join(__dirname, '..', 'node_modules', '@liamcottle', 'rustplus.js', 'rustplus.proto');
const memberPattern = /message Member \{[\s\S]*?\n\t\}/;

if (!fs.existsSync(protoPath)) process.exit(0);

const source = fs.readFileSync(protoPath, 'utf8');
const patched = source.replace(memberPattern, (member) => member
  .replace(/required float x = 3;/, 'optional float x = 3;')
  .replace(/required float y = 4;/, 'optional float y = 4;')
  .replace(/required bool isOnline = 5;/, 'optional bool isOnline = 5;')
  .replace(/required uint32 spawnTime = 6;/, 'optional uint32 spawnTime = 6;')
  .replace(/required bool isAlive = 7;/, 'optional bool isAlive = 7;')
  .replace(/required uint32 deathTime = 8;/, 'optional uint32 deathTime = 8;'))
  .replace(/(message Note \{\s*)required int32 type = 2;/, '$1optional int32 type = 2;');
fs.writeFileSync(protoPath, patched);
