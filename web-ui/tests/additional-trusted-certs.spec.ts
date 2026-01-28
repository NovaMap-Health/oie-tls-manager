import { test, expect, Page } from '@playwright/test';

const APP_BASE = '/tls-manager';
const LOGIN_ENDPOINT = '**/api/users/_login';
const TRUSTED_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/trustedCertificates';
const LOCAL_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/localCertificates';
const SYSTEM_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/systemCertificates';

type TrustedEntry = {
  alias: string;
  certificate: string;
  channelsInUse?: { string: string[] | string };
};

function buildTrustedResponse(entries: TrustedEntry[]) {
  return { list: { trustedCertificate: entries } };
}

// Minimal PEM placeholder – content is not important for UI tests here
const DUMMY_PEM = '-----BEGIN CERTIFICATE-----\\nMIIB...dummy...\\n-----END CERTIFICATE-----\\n';

async function loginAsAdmin(page: Page) {
  await page.goto(`${APP_BASE}/login`);
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin');
  await page.locator('form').locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/tls-manager\/tls/);
}

async function gotoTrustedTab(page: Page) {
  await page.goto(`${APP_BASE}/tls?tab=trusted`);
  await expect(page.getByText('Additional Trusted Certificates').first()).toBeVisible();
}

test.describe('Additional Trusted Certificates – list, search, edit, remove', () => {
  const SAMPLE_CERTS: TrustedEntry[] = [
    {
      alias: 'some test root ca',
      certificate: DUMMY_PEM,
      channelsInUse: { string: ['channel-1', 'channel-2'] },
    },
    {
      alias: 'server1',
      certificate: DUMMY_PEM,
    },
    {
      alias: 'server2',
      certificate: DUMMY_PEM,
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route(LOGIN_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: '<response><status>SUCCESS</status><message>Login successful</message></response>',
      });
    });

    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildTrustedResponse(SAMPLE_CERTS)),
      });
    });

    await page.route(LOCAL_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ list: { localCertificate: [] } }),
      });
    });

    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ list: { trustedCertificate: [] } }),
      });
    });

    await loginAsAdmin(page);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    });
    await page.unroute('**/api/**').catch(() => {});
  });

  test('1.1 – should render trusted certificate cards with actions', async ({ page }) => {
    // Act
    await gotoTrustedTab(page);

    // Assert: cards rendered for each trusted cert alias
    for (const cert of SAMPLE_CERTS) {
      await expect(page.getByText(cert.alias)).toBeVisible();
    }

    // Each card should expose View Details / Edit Alias / Remove actions for trusted store
    const firstCard = page
      .locator('.MuiPaper-root')
      .filter({ hasText: 'some test root ca' });

    await expect(firstCard.getByRole('button', { name: /view details/i })).toBeVisible();
    await expect(firstCard.getByRole('button', { name: /edit alias/i })).toBeVisible();
    await expect(firstCard.getByRole('button', { name: /remove/i })).toBeVisible();
  });

  test('1.2 – should show channels in use when channelsInUse is non-empty', async ({ page }) => {
    // Act
    await gotoTrustedTab(page);

    // Find the card for alias with channels
    const card = page
      .locator('.MuiPaper-root')
      .filter({ hasText: 'some test root ca' });

    // Assert label and (optionally) count
    await expect(card.getByText(/channels in use/i)).toBeVisible();
  });

  test('2.1 – search should filter by alias (case-insensitive)', async ({ page }) => {
    await gotoTrustedTab(page);

    const searchInput = page.getByPlaceholder('Search certificates by alias or subject…');

    // Act: type part of alias in different case
    await searchInput.fill('SERVER1');

    // Assert: only server1 card remains visible
    await expect(page.getByText('server1')).toBeVisible();
    await expect(page.getByText('some test root ca')).not.toBeVisible();
  });

  test('3.1 – edit alias happy path updates alias via PUT', async ({ page }) => {
    // Arrange: capture PUT payload
    let putPayload: unknown = null;
    let resolvePut: () => void;
    const putDone = new Promise<void>((r) => {
      resolvePut = r;
    });

    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      if (route.request().method() === 'PUT') {
        putPayload = route.request().postDataJSON();
        resolvePut();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildTrustedResponse(SAMPLE_CERTS)),
        });
      }
    });

    await gotoTrustedTab(page);

    // Act: open Edit Alias dialog for server1
    const server1Card = page
      .locator('.MuiPaper-root')
      .filter({ hasText: 'server1' });
    await server1Card.getByRole('button', { name: /edit alias/i }).click();

    const dialog = page.getByRole('dialog', { name: /edit certificate alias/i });
    const aliasField = dialog.getByLabel('New Alias');

    await aliasField.fill('server1-updated');
    await dialog.getByRole('button', { name: /update alias/i }).click();

    // Wait for PUT to complete
    await putDone;

    // Assert: PUT payload has updated alias
    expect(putPayload).not.toBeNull();
    const payload = putPayload as { list?: { trustedCertificate?: Array<{ alias: string }> } };
    const aliases = payload.list?.trustedCertificate?.map((c) => c.alias) || [];
    expect(aliases).toContain('server1-updated');
    expect(aliases).toContain('some test root ca');
  });

  test('3.2 – edit alias duplicate completes via warning and/or replace dialog without error', async ({ page }) => {
    await gotoTrustedTab(page);

    // Act: attempt to change alias of server2 to existing alias "server1"
    const server2Card = page
      .locator('.MuiPaper-root')
      .filter({ hasText: 'server2' });
    await server2Card.getByRole('button', { name: /edit alias/i }).click();

    const editDialog = page.getByRole('dialog', { name: /edit certificate alias/i });
    const aliasField = editDialog.getByLabel('New Alias');
    await aliasField.fill('server1');
    await editDialog.getByRole('button', { name: /update alias/i }).click();

    // Flow can either:
    // - close Edit Alias directly after successful update, or
    // - open Replace Existing Certificate dialog which then completes.
    const confirmDialog = page.getByRole('dialog', { name: /replace existing certificate/i });

    await Promise.race([
      confirmDialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
      editDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {}),
    ]);

    if (await confirmDialog.isVisible().catch(() => false)) {
      await confirmDialog.getByRole('button', { name: /replace certificate/i }).click();
      await expect(confirmDialog).not.toBeVisible({ timeout: 10000 });
    } else {
      // If no confirm dialog, edit dialog should have closed after update
      await expect(editDialog).not.toBeVisible({ timeout: 10000 });
    }
  });

  test('4.1 – remove certificate updates list and shows success message', async ({ page }) => {
    await gotoTrustedTab(page);

    // Act: open Remove dialog for "some test root ca"
    const rootCard = page
      .locator('.MuiPaper-root')
      .filter({ hasText: 'some test root ca' });
    await rootCard.getByRole('button', { name: /remove/i }).click();

    const removeDialog = page.getByRole('dialog', { name: /remove certificate/i });
    await expect(removeDialog).toBeVisible();

    // Confirm removal
    await removeDialog.getByRole('button', { name: /remove certificate/i }).click();

    // Success notification should mention removed alias
    await expect(
      page.getByText('Certificate "some test root ca" has been removed successfully')
    ).toBeVisible();
  });
});

