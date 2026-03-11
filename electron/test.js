console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
const eKeys = Object.keys(process).filter(k => k.toLowerCase().includes('electron') || k.toLowerCase().includes('app'));
console.log('electron-related process keys:', eKeys.join(', '));
// Check if running inside ELECTRON_RUN_AS_NODE mode
console.log('ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);
process.exit(0);
