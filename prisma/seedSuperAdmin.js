const fs = require('fs');
const path = require('path');

const distScript = path.join(__dirname, '../dist/scripts/seedSuperAdmin.js');
const srcScript = path.join(__dirname, '../src/scripts/seedSuperAdmin.ts');

if (fs.existsSync(distScript)) {
  require(distScript);
} else {
  try {
    require('ts-node/register/transpile-only');
    require(srcScript);
  } catch (err) {
    console.error('Could not run seed script. Please run "npm run build" first.\n', err);
    process.exit(1);
  }
}
