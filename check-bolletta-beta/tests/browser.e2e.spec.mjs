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

// Helper: complete the wizard with a file upload then form fill.
// The wizard starts at step 0 (upload dropzone). Setting the file on #bill-file
// triggers handleFileSelection() which advances to step 1 where the form lives.
async function fillWizardForm(page, { file, nome, telefono, email, comune } = {}) {
  // Step 0 → upload file via the hidden input (opacity:0 but not display:none)
  await page.locator('#bill-file').setInputFiles(file);

  // Now step 1 is visible — fill form fields
  await page.locator('input[name="nome"]').fill(nome);
  await page.locator('input[name="telefono"]').fill(telefono);
  if (email) await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="comune"]').fill(comune);
  // Commodity defaults to 'luce' (first choice-btn pre-selected in HTML)
  await page.locator('input[name="consentAnalysis"]').check();
}

test.describe.configure({ mode: 'serial' });

test('frontend renders a complete analysis payload (mock full-success)', async ({ page }) => {
  const server = await startServer({ port: 4173, mockMode: 'full-success' });

  try {
    await page.goto(`${server.baseUrl}/check-bolletta-beta/`);

    await fillWizardForm(page, {
      file: files.pdfLuce,
      nome: 'Mario Rossi',
      telefono: '+393331234567',
      email: 'mario@example.com',
      comune: 'Pescara',
    });

    await page.locator('button[type="submit"]').click();

    // Wait for results to appear (xAI path intercepted by the local test server).
    const resultContent = page.locator('[data-result-content]');
    await expect(resultContent).toContainText('Analisi AI reale completata.', { timeout: 60_000 });

    // The detail section always shows provider name and CTA links
    await expect(resultContent).toContainText('Duferco Energia');
    await expect(resultContent).toContainText(/possibile risparmio|risparmio/i);
    await expect(resultContent).not.toContainText('Sinergas');
    await expect(resultContent).not.toContainText('Biennale Luce Casa');

    // At least one WhatsApp / contact CTA must be present regardless of outcome
    await expect(page.locator('[data-result-content] a[href*="wa.me"], [data-result-content] a[href*="contatti"]').first()).toBeVisible({ timeout: 5_000 });

    // The AI explanation detail section is always rendered
    await expect(resultContent).toContainText('Spiegazione AI della fattura');
  } finally {
    await server.stop();
  }
});

test('frontend shows an error instead of fake results when xAI fails (mock xai-5xx)', async ({ page }) => {
  const server = await startServer({ port: 4174, mockMode: 'xai-5xx' });

  try {
    await page.goto(`${server.baseUrl}/check-bolletta-beta/`);

    await fillWizardForm(page, {
      file: files.pngReadable,
      nome: 'Giulia Verdi',
      telefono: '+393339998887',
      comune: 'Chieti',
    });

    await page.locator('button[type="submit"]').click();

    // Feedback bar warns about the real AI failure and no fake result is rendered.
    await expect(page.locator('[data-form-feedback]').first()).toContainText(
      'Analisi AI reale non disponibile',
      { timeout: 30_000 },
    );

    await expect(page.locator('[data-wizard]')).toHaveAttribute('data-step', '1');
    await expect(page.locator('[data-result-content]')).toBeEmpty();
  } finally {
    await server.stop();
  }
});

test('frontend live path renders a real xAI payload when enabled', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_LIVE !== '1', 'Set PLAYWRIGHT_LIVE=1 to run live browser verification');
  const server = await startServer({ port: 4175, mockMode: 'none', allowTempCredentials: true });

  try {
    await page.goto(`${server.baseUrl}/check-bolletta-beta/`);

    await fillWizardForm(page, {
      file: files.pdfLuce,
      nome: 'Live Browser',
      telefono: '+393331234000',
      email: 'live-browser@example.com',
      comune: 'Montesilvano',
    });

    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[data-result-content]')).toContainText(
      'Analisi AI reale completata.',
      { timeout: 240_000 },
    );
    await expect(page.locator('[data-result-content]')).not.toContainText(
      'Esempio dimostrativo.',
      { timeout: 240_000 },
    );
  } finally {
    await server.stop();
  }
});
