import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const serverScript = resolve(process.cwd(), 'check-bolletta-beta/scripts/local-beta-server.mjs');
const files = {
  pdfLuce: resolve(process.cwd(), 'check-bolletta-beta/docs/00125FT01549423.PDF'),
  pngReadable: resolve(process.cwd(), 'check-bolletta-beta/fixtures/generated/luce-readable.png'),
};

async function startServer({ port, mockMode = 'none', allowTempCredentials = false }) {
  const child = spawn(process.execPath, [serverScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      MOCK_EXTERNAL_MODE: mockMode,
      ALLOW_TEMP_CREDENTIALS_FILE: allowTempCredentials ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/check-bolletta-beta/`);
      if (response.ok) {
        return {
          child,
          baseUrl: `http://127.0.0.1:${port}`,
          stop: async () => {
            child.kill('SIGTERM');
            await once(child, 'exit').catch(() => {});
          },
        };
      }
    } catch {}
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }

  child.kill('SIGTERM');
  throw new Error(`Server did not start in time. Output:\n${output}`);
}

test.describe.configure({ mode: 'serial' });

test('frontend renders a complete analysis payload', async ({ page }) => {
  const server = await startServer({ port: 4173, mockMode: 'full-success' });

  try {
    await page.goto(`${server.baseUrl}/check-bolletta-beta/`);
    await page.locator('input[name="nome"]').fill('Mario Rossi');
    await page.locator('input[name="telefono"]').fill('+393331234567');
    await page.locator('input[name="email"]').fill('mario@example.com');
    await page.locator('input[name="comune"]').fill('Pescara');
    await page.locator('select[name="commodityHint"]').selectOption('luce');
    await page.locator('#bill-file').setInputFiles(files.pdfLuce);
    await page.locator('input[name="consentAnalysis"]').check();
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[data-result-content]')).toContainText('Analisi reale completata.');
    await expect(page.locator('[data-result-content]')).toContainText('La bolletta e guidata soprattutto da quota energia, costi di rete e canone TV.');
    await expect(page.locator('[data-result-content]')).toContainText('Richiedi una verifica');
  } finally {
    await server.stop();
  }
});

test('frontend renders fallback when xAI fails', async ({ page }) => {
  const server = await startServer({ port: 4174, mockMode: 'xai-5xx' });

  try {
    await page.goto(`${server.baseUrl}/check-bolletta-beta/`);
    await page.locator('input[name="nome"]').fill('Giulia Verdi');
    await page.locator('input[name="telefono"]').fill('+393339998887');
    await page.locator('input[name="comune"]').fill('Chieti');
    await page.locator('#bill-file').setInputFiles(files.pngReadable);
    await page.locator('input[name="consentAnalysis"]').check();
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[data-form-feedback]')).toContainText('Analisi reale non disponibile');
    await expect(page.locator('[data-result-content]')).toContainText('Fallback beta attivo.');
  } finally {
    await server.stop();
  }
});

test('frontend live path renders a real xAI payload when enabled', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_LIVE !== '1', 'Set PLAYWRIGHT_LIVE=1 to run live browser verification');
  const server = await startServer({ port: 4175, mockMode: 'none', allowTempCredentials: true });

  try {
    await page.goto(`${server.baseUrl}/check-bolletta-beta/`);
    await page.locator('input[name="nome"]').fill('Live Browser');
    await page.locator('input[name="telefono"]').fill('+393331234000');
    await page.locator('input[name="email"]').fill('live-browser@example.com');
    await page.locator('input[name="comune"]').fill('Montesilvano');
    await page.locator('select[name="commodityHint"]').selectOption('luce');
    await page.locator('#bill-file').setInputFiles(files.pdfLuce);
    await page.locator('input[name="consentAnalysis"]').check();
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[data-result-content]')).toContainText('Analisi reale completata.', { timeout: 240000 });
    await expect(page.locator('[data-result-content]')).not.toContainText('Fallback beta attivo.', { timeout: 240000 });
  } finally {
    await server.stop();
  }
});
