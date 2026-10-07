// ledger.js
const fs = require('fs');
const path = require('path');

function createLedger(name) {
  const ledgerPath = path.join(__dirname, 'data', `${name}.json`);
  fs.writeFileSync(ledgerPath, '[]');
}

function listLedgers() {
  const ledgers = fs.readdirSync(path.join(__dirname, 'data'));
  return ledgers.map(ledger => ledger.slice(0, -5));
}

function loadLedger(name) {
  const ledgerPath = path.join(__dirname, 'data', `${name}.json`);
  const data = fs.readFileSync(ledgerPath, 'utf8');
  return JSON.parse(data);
}

function saveLedger(name, ledger) {
  const ledgerPath = path.join(__dirname, 'data', `${name}.json`);
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
}

function addEntry(name, entry) {
  const ledger = loadLedger(name);
  ledger.push(entry);
  saveLedger(name, ledger);
}

function searchLedger(name, key, value) {
  const ledger = loadLedger(name);
  const matchingEntries = ledger.filter(entry => entry[key] === value);
  return matchingEntries;
}

function listLedgerActs(name) {
  const ledger = loadLedger(name);
  const acts = ledger.map(entry => entry.act);
  return acts;
}

module.exports = { createLedger, listLedgers, loadLedger, saveLedger, addEntry, searchLedger, listLedgerActs };
