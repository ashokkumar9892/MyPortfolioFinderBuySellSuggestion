// Kills any processes using the dev ports before starting
const { execSync } = require('child_process');
const PORTS = [7099, 7000, 7001, 7002];

for (const port of PORTS) {
  try {
    const out = execSync(`netstat -ano 2>nul`, { shell: 'cmd.exe', encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l.includes(`:${port} `) || l.includes(`:${port}\r`));
    const pids = [...new Set(lines.map(l => l.trim().split(/\s+/).pop()).filter(p => p && p !== '0'))];
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { shell: 'cmd.exe', stdio: 'ignore' });
        console.log(`Killed PID ${pid} on port ${port}`);
      } catch (_) { /* already gone */ }
    }
  } catch (_) { /* netstat not available */ }
}
