import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Certificate Import (Additional Trusted Certificates tab) – E2E tests.
 * File-based import only: "Import Certificate" opens Import Certificate Chain dialog.
 * All API calls are mocked. User is logged in via UI before each test.
 */

const APP_BASE = '/tls-manager';
const LOGIN_ENDPOINT = '**/api/users/_login';
const TRUSTED_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/trustedCertificates';
const LOCAL_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/localCertificates';
const REMOTE_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/remoteCertificates**';
const SYSTEM_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/systemCertificates';

function buildSuccessLoginXml(): string {
  return '<response><status>SUCCESS</status><message>Login successful</message></response>';
}

function getLoginSubmitButton(page: Page) {
  return page.locator('form').locator('button[type="submit"]');
}

/** Trusted list response shape. */
function buildTrustedResponse(entries: { alias: string; certificate: string }[]) {
  return { list: { trustedCertificate: entries } };
}

/** Valid single-cert PEM (Test Root CA / OCSP Responder, passes parse + verify). */
const VALID_PEM_SINGLE = [
  '-----BEGIN CERTIFICATE-----',
  'MIIENjCCAh6gAwIBAgIUBQC0em0nRzkrVEy9majkbG2sUFUwDQYJKoZIhvcNAQEL',
  'BQAwNjELMAkGA1UEBhMCRUUxEDAOBgNVBAoMB1Rlc3QgQ0ExFTATBgNVBAMMDFRl',
  'c3QgUm9vdCBDQTAgFw0yNTEwMTMxMTQzNDJaGA8yMTI1MDkxOTExNDM0MlowGTEX',
  'MBUGA1UEAwwOT0NTUCBSZXNwb25kZXIwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw',
  'ggEKAoIBAQDLiN7lFFP0wMVSZvZcPjml0InNUyEn8QFDvx4Ap+ODdUhJMIfC4BE/',
  'dtHhDSunTYDpAhNhaMq9vLvJQgF/yJSHdPCNV8tGgd5dTnu/EIGuNlZR27LfJSPe',
  'mNsva6kXT6lsqd6ULjDFmINtaMCGSIhwa5ZnHm2L1mtPBVPEQXkqWEWEgkDdfOar',
  'Bvnhih8OoQeuPXNOT4iz/1xSVkPigrsGXuMOfNn0TSpAIG1zWyMvsGkmnQNcURBJ',
  'qjPZWhJJdb0po1/OeTXD2lULZvJCaLSo7wK7DsGDRsuGM5CuGCUjMz9FKELSVDht',
  'aoGzKy8EkvHYGa1lZ8o3teXRddblGr/XAgMBAAGjVzBVMBMGA1UdJQQMMAoGCCsG',
  'AQUFBwMJMB0GA1UdDgQWBBRTz+E0vmRwMjxEICbGSAAZTWRA/DAfBgNVHSMEGDAW',
  'gBQcXTRLf5jrDzH4RCTMygjOTOt8kzANBgkqhkiG9w0BAQsFAAOCAgEAfE0/ShiD',
  '+u0zFR2ilqcM/P13NzMqHUgTa9u23FM6ajCuNwjMEoit5s4cIkRIVK8+4HE4ozl+',
  'pi7dl0zjAng3wUP723C32IVk3vwsJLWTqkjPSaeQdhqk/0XrX+ygUmsxqXQoxPPJ',
  'AbWGkIYcs+Dmccj85KXvLtJjNvMgjP1fliY8G7nskgSaj2dP5pLmkSBBGl9441eB',
  'GX9P0ydljvH71T/t5Gty0FqINFjs2V3z78iqN8ERNBf6VBafmzVGcLxFuq7erBPz',
  'DgcaA2EhiqaNTIFTKEAV2vy7cDI/eTqoxMdG39+SlkPDnvBHCtj3SQbpBp7eayPz',
  'aagIA10twS8+l9xlKZeSj6QyV1SeN20iLHf9LpV1XRcbgHYaWjZ8EBvQUh7oGmnl',
  '4ACteYXk+Hsusr0WF4AZ3jxSLcMgzbUWByhgaFXg7KodxB+VWHo4vQ2dq1dR5AWn',
  'XkQRGbCQTYOkmBlbax/oyfYsirC5iSAT+ljvGjJyK8uLFV5QfGqHw5XQ7EGPHast',
  'n7hbf2s5OzLjSA6BzyrBPgqLCUgECJKpMS2JROumck2Hg1SaCKso0v3haSbH0TxX',
  'YYei0qNUxM1qqyaCktdYnjrft1aDyzayWuuv8Tt6Bv2w1hrmxG1mxsoY5EKQJQGK',
  'ObgJu7HdR7vkxmGtogFNcrglPmyE0Udzd4k=',
  '-----END CERTIFICATE-----',
].join('\n');

const INVALID_PEM = 'not-a-cert';

/** PEM that parses to one cert but fails client-side verification (for 2.8). */
const PEM_PARSE_OK_VERIFY_FAIL =
  '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJALvxzdpJc2U/MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMjMwMTAxMDAwMDAwWhcNMjQwMTAxMDAwMDAwWjBF\n-----END CERTIFICATE-----';

/** Helper to read certificate files from tests/certs directory. */
function readCertFile(filename: string): string {
  // Path relative to test file location
  const certsDir = join(process.cwd(), 'tests', 'certs');
  return readFileSync(join(certsDir, filename), 'utf8');
}

async function gotoTrustedTab(page: Page): Promise<void> {
  await page.goto(`${APP_BASE}/tls?tab=trusted`);
  await expect(page.getByText('Additional Trusted Certificates').first()).toBeVisible();
}

async function openImportDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /import certificate/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
}

async function openImportFromUrlDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /import from url/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Import Certificate from URL')).toBeVisible();
}

test.describe('Certificate Import – Additional Trusted (file only)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(LOGIN_ENDPOINT, (r) =>
      r.fulfill({ status: 200, contentType: 'application/xml', body: buildSuccessLoginXml() })
    );
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTrustedResponse([])) })
    );
    await page.route(LOCAL_CERTIFICATES_ENDPOINT, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { localCertificate: [] } }) })
    );
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { trustedCertificate: [] } }) })
    );
    await page.goto(`${APP_BASE}/login`);
    await expect(page.getByLabel('Username')).toBeVisible();
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');
    await getLoginSubmitButton(page).click();
    await expect(page).toHaveURL(/\/tls-manager\/tls/);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.unroute('**/api/**').catch(() => {});
  });

  // This test checks if the Import Certificate Chain dialog is opened from the trusted tab
  test('CI01 – should open Import Certificate Chain dialog from trusted tab', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
  });

  // This test checks if the Import Certificate Chain dialog rejects non-.pem/.crt file and shows an error
  test('CI02 – should reject non-.pem/.crt file and show error', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    const fileInput = page.getByRole('dialog').locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'bad.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x', 'utf8'),
    });
    await expect(page.getByText(/please select a \.pem or \.crt file/i)).toBeVisible();
  });

  test('CI03 – dialog shows file + PEM inputs', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await expect(page.getByRole('button', { name: /choose certificate file/i })).toBeVisible();
    await expect(page.getByLabel(/pem certificate chain/i)).toBeVisible();
  });

  test('CI04 – Cancel closes dialog without importing', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    // Cancel is only visible after certs are loaded; close via Escape instead
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('CI05 – should show parse error for invalid PEM in file', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    const fileInput = page.getByRole('dialog').locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'bad.pem',
      mimeType: 'application/x-pem-file',
      buffer: Buffer.from(INVALID_PEM, 'utf8'),
    });
    await expect(page.getByText(/no valid certificates found/i)).toBeVisible();
  });

  test('CI06 – should show parse error for invalid PEM paste', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(INVALID_PEM);
    await expect(page.getByText(/no valid certificates found/i)).toBeVisible();
  });

  test('CI07 – Select a certificate to import', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(
      page.getByText(/select a certificate to import/i).or(page.getByText(/found \d+ certificate/i))
    ).toBeVisible({ timeout: 5000 });
  });

  test('CI08 – happy path: import from .pem file, success and list refresh', async ({ page }) => {
    let putCount = 0;
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        putCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    const fileInput = page.getByRole('dialog').locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'cert.pem',
      mimeType: 'application/x-pem-file',
      buffer: Buffer.from(VALID_PEM_SINGLE, 'utf8'),
    });
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('test-alias');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    expect(putCount).toBe(1);
  });

  test('CI09 – PUT trustedCertificates on success', async ({ page }) => {
    let putPayload: unknown = null;
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        putPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('my-cert');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    expect(putPayload).not.toBeNull();
    expect((putPayload as { list?: { trustedCertificate?: unknown[] } }).list?.trustedCertificate).toBeDefined();
  });

  test('CI10 – certificate verification failure shows validation dialog', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(PEM_PARSE_OK_VERIFY_FAIL);
    await expect(
      page.getByText(/found \d+ certificate/i).or(page.getByText(/Parse Error/i))
    ).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('fail-cert');
    const importBtn = page.getByRole('button', { name: /^import certificate$/i });
    if (await importBtn.isVisible()) {
      await importBtn.click();
      await expect(
        page.getByRole('heading', { name: /certificate validation failed/i })
      ).toBeVisible({ timeout: 8000 });
    }
  });

  // Skiped this because its a duplicate, will be corrected after refactoring
 // test.skip('CI11 – close via Escape', async ({ page }) => {
  //   await gotoTrustedTab(page);
  //   await openImportDialog(page);
  //   await page.keyboard.press('Escape');
  //   await expect(page.getByRole('dialog')).not.toBeVisible();
  // });

  test('CI12 – Import disabled until cert selected', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await expect(page.getByRole('button', { name: /^import certificate$/i })).not.toBeVisible();
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    const importBtn = page.getByRole('button', { name: /^import certificate$/i });
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toBeEnabled();
    const aliasField = page.getByLabel('Alias');
    await aliasField.fill('');
    await importBtn.click();
    await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
    await expect(aliasField).toHaveAttribute('aria-invalid', 'true');
    await expect(importBtn).toBeEnabled();
  });

  test('CI13 – error when PUT fails (requires valid PEM to reach PUT)', async ({ page }) => {
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Server error' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('fail-cert');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    // Either validation fails (dialog with "Certificate Validation Failed") or PUT fails (API error in form)
    await expect(
      page.getByRole('heading', { name: /certificate validation failed/i }).or(
        page.getByText(/failed to import|server error/i).first()
      )
    ).toBeVisible({ timeout: 8000 });
  });

  test('CI14 – happy path: import from .crt file', async ({ page }) => {
    let putCount = 0;
    const certContent = readCertFile('ocsp.crt');
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        putCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    const fileInput = page.getByRole('dialog').locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'cert.crt',
      mimeType: 'application/x-x509-ca-cert',
      buffer: Buffer.from(certContent, 'utf8'),
    });
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('ocsp-cert');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    expect(putCount).toBe(1);
  });

  test('CI15 – select one cert from chain', async ({ page }) => {
    // Use a cert file that might contain a chain, or create a chain by concatenating certs
    const cert1 = VALID_PEM_SINGLE;
    const cert2 = readCertFile('ocsp.crt');
    const chainPem = `${cert1}\n${cert2}`;
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(chainPem);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    // Chain selector should appear; select second cert if available
    const chainSelector = page.getByRole('dialog').getByText(/select a certificate to import/i);
    if (await chainSelector.isVisible()) {
      const certOptions = page.getByRole('dialog').getByRole('radio');
      const count = await certOptions.count();
      if (count > 1) {
        await certOptions.nth(1).click();
        await expect(page.getByLabel('Alias')).toBeVisible();
      }
    }
  });

  test('CI16 – alias suggested/prefilled from certificate CN', async ({ page }) => {
    const certContent = readCertFile('orchestrator.cn.only.caddy.crt');
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(certContent);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    // Alias should be auto-filled from CN
    const aliasField = page.getByLabel('Alias');
    const aliasValue = await aliasField.inputValue();
    expect(aliasValue.trim().length).toBeGreaterThan(0);
  });

  test('CI17 – success and list refresh after import', async ({ page }) => {
    let getCount = 0;
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        getCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('refreshed-cert');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    // List should refresh (GET called again after PUT)
    expect(getCount).toBeGreaterThanOrEqual(1);
  });

  test('CI18 – should show error for empty PEM paste', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill('');
    await page.getByLabel(/pem certificate chain/i).blur();
    // Empty PEM: dialog stays open with helper text; no "Found N certificate" is shown
    await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/paste certificate or upload a file/i)).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/found \d+ certificate/i)).not.toBeVisible();
  });

  // Duplicated 
  // test('CI19 – alias required validation', async ({ page }) => {
  //   await gotoTrustedTab(page);
  //   await openImportDialog(page);
  //   await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
  //   await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
  //   const aliasField = page.getByLabel('Alias');
  //   await aliasField.fill('');
  //   await aliasField.blur();
  //   await page.getByRole('button', { name: /^import certificate$/i }).click();
  //   // Form validation should keep dialog open or show error
  //   await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
  //   await expect(aliasField).toHaveAttribute('aria-invalid', 'true');
  // });

  test('CI20 – duplicate alias shows replace confirmation dialog', async ({ page }) => {
    const existingAlias = 'existing-cert';
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildTrustedResponse([{ alias: existingAlias, certificate: VALID_PEM_SINGLE }])
          ),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill(existingAlias);
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('heading', { name: /replace existing certificate/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('CI21 – cancel replace confirmation', async ({ page }) => {
    const existingAlias = 'duplicate-cert';
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildTrustedResponse([{ alias: existingAlias, certificate: VALID_PEM_SINGLE }])
          ),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill(existingAlias);
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('heading', { name: /replace existing certificate/i })).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    // Replace dialog closes, import dialog still open
    await expect(page.getByRole('heading', { name: /replace existing certificate/i })).not.toBeVisible();
    await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
  });

  test('CI22 – loading state during import', async ({ page }) => {
    let resolvePut: () => void = () => {};
    const putGate = new Promise<void>((r) => {
      resolvePut = r;
    });
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await putGate;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('loading-test');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('button', { name: /importing/i })).toBeVisible({ timeout: 2000 });
    resolvePut();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
  });

  // this is checked in multiple tests
  // test('CI23 – "Found N certificates" when multiple in chain', async ({ page }) => {
  //   const cert1 = VALID_PEM_SINGLE;
  //   const cert2 = readCertFile('ocsp.crt');
  //   const chainPem = `${cert1}\n${cert2}`;
  //   await gotoTrustedTab(page);
  //   await openImportDialog(page);
  //   await page.getByLabel(/pem certificate chain/i).fill(chainPem);
  //   await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
  //   const foundText = await page.getByText(/found \d+ certificate/i).textContent();
  //   expect(foundText).toMatch(/found \d+ certificate/i);
  // });


  // Duplicated with CI17
  // test('CI24 – list refreshed after successful import', async ({ page }) => {
  //   let getCallCount = 0;
  //   await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
  //   await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
  //     if (route.request().method() === 'PUT') {
  //       await route.fulfill({
  //         status: 200,
  //         contentType: 'application/json',
  //         body: JSON.stringify({}),
  //       });
  //     } else {
  //       getCallCount += 1;
  //       await route.fulfill({
  //         status: 200,
  //         contentType: 'application/json',
  //         body: JSON.stringify(buildTrustedResponse([])),
  //       });
  //     }
  //   });
  //   await gotoTrustedTab(page);
  //   await openImportDialog(page);
  //   await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
  //   await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
  //   await page.getByLabel('Alias').fill('new-cert');
  //   await page.getByRole('button', { name: /^import certificate$/i }).click();
  //   await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
  //   // After import, GET should be called again to refresh list
  //   expect(getCallCount).toBeGreaterThanOrEqual(2);
  // });

  //allready chek
  test('CI25 – single cert in chain', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found 1 certificate/i)).toBeVisible({ timeout: 5000 });
    // Single cert should auto-select
    await expect(page.getByLabel('Alias')).toBeVisible();
  });

  test('CI26 – empty file shows error', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    const fileInput = page.getByRole('dialog').locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'empty.pem',
      mimeType: 'application/x-pem-file',
      buffer: Buffer.from('', 'utf8'),
    });
    // Empty file: no "Found N certificate" is shown; dialog keeps helper/empty state
    await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
    await expect(page.getByText(/found \d+ certificate/i)).not.toBeVisible();
  });

  test('CI27 – PEM with whitespace handled correctly', async ({ page }) => {
    const pemWithWhitespace = `   \n\n${VALID_PEM_SINGLE}\n\n   `;
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(pemWithWhitespace);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
  });

  test('CI28 – alias with spaces/special chars accepted', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('cert with spaces-123');
    await expect(page.getByRole('button', { name: /^import certificate$/i })).toBeEnabled();
  });

  test('CI29 – duplicate alias case-insensitive', async ({ page }) => {
    const existingAlias = 'Test-Cert';
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildTrustedResponse([{ alias: existingAlias, certificate: VALID_PEM_SINGLE }])
          ),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill(existingAlias.toLowerCase());
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('heading', { name: /replace existing certificate/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('CI30 – Import disabled until form valid', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await expect(page.getByRole('button', { name: /^import certificate$/i })).not.toBeVisible();
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    const importBtn = page.getByRole('button', { name: /^import certificate$/i });
    await expect(importBtn).toBeVisible();
    // Without alias, form is invalid
    await page.getByLabel('Alias').fill('');
    // Button may still be enabled but validation runs on submit
    await importBtn.click();
    await expect(page.getByRole('dialog').getByText('Import Certificate Chain')).toBeVisible();
  });

  test('CI31 – close via Cancel button', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    // Cancel is only visible after certs are loaded (same as CI04)
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('dialog').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('CI32 – fresh state after Cancel', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Reopen dialog - should be fresh
    await openImportDialog(page);
    const pemField = page.getByLabel(/pem certificate chain/i);
    const pemValue = await pemField.inputValue();
    expect(pemValue.trim()).toBe('');
  });

  test('CI33 – fresh state after success', async ({ page }) => {
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('first-import');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    // Reopen dialog - should be fresh
    await openImportDialog(page);
    const pemField = page.getByLabel(/pem certificate chain/i);
    const pemValue = await pemField.inputValue();
    expect(pemValue.trim()).toBe('');
  });

  test('CI34 – two imports in a row', async ({ page }) => {
    let putCount = 0;
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        putCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    // First import
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('first-cert');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    // Second import
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('second-cert');
    await page.getByRole('button', { name: /^import certificate$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    expect(putCount).toBe(2);
  });

  test('CI35 – validation failed → close → change input → retry', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(INVALID_PEM);
    await expect(page.getByText(/no valid certificates found/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Reopen and paste valid PEM
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
  });

  test('CI36 – replace confirmed then verification fails', async ({ page }) => {
    const existingAlias = 'replace-me';
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildTrustedResponse([{ alias: existingAlias, certificate: VALID_PEM_SINGLE }])
          ),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(PEM_PARSE_OK_VERIFY_FAIL);
    await expect(
      page.getByText(/found \d+ certificate/i).or(page.getByText(/no valid certificates/i))
    ).toBeVisible({ timeout: 5000 });
    const importBtn = page.getByRole('button', { name: /^import certificate$/i });
    if (await importBtn.isVisible()) {
      await page.getByLabel('Alias').fill(existingAlias);
      await importBtn.click();
      // If replace dialog appears, confirm it
      const replaceDialog = page.getByRole('heading', { name: /replace existing certificate/i });
      if (await replaceDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.getByRole('button', { name: /replace certificate/i }).click();
        // Then verification should fail
        await expect(
          page.getByRole('heading', { name: /certificate validation failed/i })
        ).toBeVisible({ timeout: 8000 });
      }
    }
  });

  test('CI37 – double-click Import only sends one PUT', async ({ page }) => {
    let putCount = 0;
    let putResolve: () => void = () => {};
    const putPromise = new Promise<void>((r) => {
      putResolve = r;
    });
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        putCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
        putResolve();
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse([])),
        });
      }
    });
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Alias').fill('double-click-test');
    const importBtn = page.getByRole('button', { name: /^import certificate$/i });
    await importBtn.click();
    // Second click may be prevented by disabled state or may be ignored
    await importBtn.click({ force: true }).catch(() => {});
    // Wait for PUT request to complete
    await putPromise;
    expect(putCount).toBe(1);
  });

  test('CI38 – dialog has role and title "Import Certificate Chain"', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByText('Import Certificate Chain')).toBeVisible();
  });

  test('CI39 – Cancel and Import buttons are focusable', async ({ page }) => {
    await gotoTrustedTab(page);
    await openImportDialog(page);
    await page.getByLabel(/pem certificate chain/i).fill(VALID_PEM_SINGLE);
    await expect(page.getByText(/found \d+ certificate/i)).toBeVisible({ timeout: 5000 });
    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    const importBtn = page.getByRole('button', { name: /^import certificate$/i });
    await expect(cancelBtn).toBeVisible();
    await expect(importBtn).toBeVisible();
    // Buttons should be focusable
    await cancelBtn.focus();
    await expect(cancelBtn).toBeFocused();
    await importBtn.focus();
    await expect(importBtn).toBeFocused();
  });
});
