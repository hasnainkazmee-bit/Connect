import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const file = new URL('../.env', import.meta.url);
let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const settings = {
  AUTH_TOKEN_SECRET: crypto.randomBytes(32).toString('hex'),
  GARAGE_RPC_SECRET: crypto.randomBytes(32).toString('hex'),
  S3_ACCESS_KEY_ID: 'GK' + crypto.randomBytes(16).toString('hex'),
  S3_SECRET_ACCESS_KEY: crypto.randomBytes(32).toString('hex'),
  S3_ENDPOINT: 'http://127.0.0.1:3900', S3_REGION: 'garage', S3_BUCKET: 'connect-media',
  STORAGE_BACKEND: 's3', REQUIRE_EMAIL_VERIFICATION: 'true',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: '1026', SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false',
  MAIL_FROM: 'Connect <hello@connect.local>',
};
for (const [key,value] of Object.entries(settings)) {
  const current = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!current) content += `\n${key}=${value}`;
  else if (!current[1].trim()) content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}
fs.writeFileSync(file, content.trimEnd() + '\n', {mode:0o600});
console.log('Local configuration saved. Existing secrets and settings were preserved.');
const child = spawnSync('docker', ['compose', '--profile', 'dev', 'up', '-d', 'db', 'mail', 'storage'], {cwd: new URL('..', import.meta.url), stdio: 'inherit'});
process.exitCode = child.status ?? 1;
