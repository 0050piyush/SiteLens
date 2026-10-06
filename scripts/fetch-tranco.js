// Downloads the latest Tranco top-1M list into data/tranco.csv.
import { downloadList } from '../src/rank.js';

console.log('Downloading the Tranco top-1M list…');
downloadList()
  .then((s) => console.log(`Saved ${s.domains.toLocaleString()} domains to data/tranco.csv`))
  .catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
