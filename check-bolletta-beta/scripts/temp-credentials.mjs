import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_CREDENTIALS_PATH = resolve(process.cwd(), 'check-bolletta-beta/aws_credential.md');

function extractValue(content, pattern) {
  const match = content.match(pattern);
  return match?.[1]?.trim() || '';
}

export function readTempCredentials(filePath = DEFAULT_CREDENTIALS_PATH) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  return {
    AWS_ACCESS_KEY_ID: extractValue(content, /access key aws\s+([A-Z0-9]+)/i),
    AWS_SECRET_ACCESS_KEY: extractValue(content, /Secret access key\s+([A-Za-z0-9/+=]+)/i),
    SENDGRID_API_KEY: extractValue(content, /sendgrid api key\s+([^\s]+)/i),
    XAI_API_KEY: extractValue(content, /XAI_API_KEY="?([^"\n]+)"?/i),
    OPENAI_API_KEY: extractValue(content, /opneai apikey\s+([^\s]+)/i),
  };
}

export function applyTempCredentials({ filePath, includeAws = false } = {}) {
  const credentials = readTempCredentials(filePath);
  const applied = [];

  for (const [key, value] of Object.entries(credentials)) {
    if (!value) continue;
    if (!includeAws && key.startsWith('AWS_')) continue;
    if (!process.env[key]) {
      process.env[key] = value;
      applied.push(key);
    }
  }

  return applied;
}
