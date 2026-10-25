'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
function loadWorldGen() {
  const src = ['world.js', 'gen.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'worldgen.js' });
  sandbox.eval = (code) => vm.runInContext(code, sandbox);
  return sandbox;
}
module.exports = { loadWorldGen };
