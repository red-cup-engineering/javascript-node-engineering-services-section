// index.js

const express = require('express');
const app = express();

const val = require('./val.js')

const bodyParser = require('body-parser');

app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send(`
    <h1>Welcome to VAL!</h1>
    <p>Vernacular Activity Ledger (VAL) is a system for recording and maintaining various activities and their associated data.</p>
    <p>To submit an entry, go to <a href="/submit-entry">Submit Entry</a>.</p>
    <p>To view the map, go to <a href="/view-map">View Map</a>.</p>
  `);
});
app.get('/', (req, res) => {
  res.send('Vernacular Activity LedgerWelcome to VAL! Please go to /submit-entry to submit an entry, or go to /view-map to see the map.');
});

app.get('/submit-entry', (req, res) => {
  const existingLedgers = val.ledger.listLedgers()
  res.send(`
    <h1>Submit Entry</h1>
    <form action="/submit-entry" method="post">
      <label for="ledger">Choose a ledger:</label>
      <select id="ledger" name="ledger">
        <option value="nil">-</option>
        ${existingLedgers.map(ledger => `<option value="${ledger}">${ledger}</option>`).join('')}
      </select>
      <input type="text" id="newLedger" name="newLedger">
      <label for="act">Choose an act:</label>
      <select id="act" name="act">
        <option value="womble">womble</option>
        <!-- Add more act options here if needed -->
      </select>
      <input type="text" id="key1" name="key1" placeholder="Enter key">
      <input type="text" id="value1" name="value1" placeholder="Enter value">
      <input type="text" id="key2" name="key2" placeholder="Enter key">
      <input type="text" id="value2" name="value2" placeholder="Enter value">
      <!-- Add more key-value fields here if needed -->
      <input type="submit" value="Submit">
    </form>
  `);
});
app.post('/submit-entry', (req, res) => {
  const number = req.body.number;
  val.ledger.addEntry("foo", { act: 'womble', count: parseInt(number) })
  res.send('Entry submitted successfully!');
});

app.get('/view-map', (req, res) => {
  const foo = val.ledger.loadLedger("foo");
  res.send(`If you add up how many wombles you counted, there are ${foo.reduce((a, b) => a + b.count, 0)} wombles in the ledger.`);
  // Display the map
});

app.listen(3000, () => {
  console.log('VAL app listening on port 3000!');
});