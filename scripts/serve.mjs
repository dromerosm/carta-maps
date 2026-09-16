import { spawn } from 'node:child_process';
// Keep developer storage and log explorers off the HTTP port used by previews.
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', '8787', '--local-upstream', '127.0.0.1:8787'], {
  stdio: 'inherit', env: { ...process.env, X_LOCAL_EXPLORER: 'false', X_LOCAL_OBSERVABILITY: 'false' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
