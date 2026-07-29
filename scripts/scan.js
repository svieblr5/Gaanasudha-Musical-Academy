// Standalone library scan: `npm run scan`
// Useful for bulk-indexing after copying files in via File Explorer.
import * as lib from '../src/library.js';

lib.loadCachedLibrary();
console.log('Scanning music library...');
const count = await lib.scanLibrary({
  onProgress: (done, total) => {
    if (done % 25 === 0 || done === total) {
      process.stdout.write(`\r  ${done}/${total} files processed`);
    }
  },
});
console.log(`\nDone. Indexed ${count} track(s).`);
