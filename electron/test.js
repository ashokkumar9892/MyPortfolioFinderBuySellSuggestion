
  const tests = ['electron', 'electron/main', 'electron/common'];
  tests.forEach(m => {
    try {
      const mod = require(m);
      console.log(m, '->', typeof mod, typeof mod === 'object' ? Object.keys(mod).slice(0,5).join(',') : String(mod).slice(0,40));
    } catch(err) {
      console.log(m, '-> ERROR:', err.message.slice(0,60));
    }
  });
  process.exit(0);
