import { test, expect, Page } from '@playwright/test';

/**
 * Native Java Certificate Store – E2E tests.
 * This tab is read-only: users can view certificate cards, open details, and verify certificates.
 * All API calls are mocked. The test user is logged in via the UI before each test.
 */

const APP_BASE = '/tls-manager';
const LOGIN_ENDPOINT = '**/api/users/_login';
const SYSTEM_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/systemCertificates';
const TRUSTED_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/trustedCertificates';
const LOCAL_CERTIFICATES_ENDPOINT = '**/api/tlsmanager/localCertificates';

/** XML success response shape expected by loginWithCredentials (authService). */
function buildSuccessLoginXml(): string {
  return '<response><status>SUCCESS</status><message>Login successful</message></response>';
}

/** Stable locator for the login form submit button. */
function getLoginSubmitButton(page: Page) {
  return page.locator('form').locator('button[type="submit"]');
}

/**
 * Response shape expected by fetchSystemCertificates (tlsService).
 * Supports array or single object in list.trustedCertificate.
 */
function buildSystemCertificatesResponse(entries: { alias: string; certificate: string }[]) {
  return {
    list: {
      trustedCertificate: entries.length === 1 ? entries[0] : entries,
    },
  };
}

/**
 * Navigate to the Native Java Certificate Store. Call only after the user is logged in
 * (e.g. after beforeEach has completed). Reloads the TLS page with tab=native so the
 * system-certificates API is triggered (must be mocked by the test before calling).
 */
async function gotoNativeTab(page: Page, query = '?tab=native'): Promise<void> {
  await page.goto(`${APP_BASE}/tls${query}`);
  await expect(page.getByText('Native Java Certificate Store').first()).toBeVisible();
}

test.describe('Native Java Certificate Store', () => {
  /**
   * Log in via the UI before each test so the test user is authenticated on the app origin.
   * Mock trusted/local cert APIs so useCertificates preload on /tls does not get 401 and redirect to login.
   */
  test.beforeEach(async ({ page }) => {
    await page.route(LOGIN_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: buildSuccessLoginXml(),
      });
    });
    await page.route(TRUSTED_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ list: { trustedCertificate: [] } }),
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
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await page.goto(`${APP_BASE}/login`);
    await expect(page.getByLabel('Username')).toBeVisible();
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');
    await getLoginSubmitButton(page).click();
    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await page.unroute(LOGIN_ENDPOINT).catch(() => {});
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.unroute(TRUSTED_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.unroute(LOCAL_CERTIFICATES_ENDPOINT).catch(() => {});
  });

  test('should show Native Java Certificate Store toolbar title and read-only warning when on native tab', async ({
    page,
  }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('Native Java Certificate Store').first()).toBeVisible();
    await expect(page.getByText('Read-only system store')).toBeVisible();
  });

  test('should show no import edit or remove actions on native tab', async ({ page }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByRole('button', { name: /import/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /edit alias/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(0);
  });

  test('should show search input on native tab', async ({ page }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByPlaceholder(/search certificates/i)).toBeVisible();
  });

  test('should show native tab when navigating to TLS page with default or tab=native', async ({
    page,
  }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page);
    await expect(page).toHaveURL(/\/tls-manager\/tls/);
    await expect(page.getByText('Native Java Certificate Store').first()).toBeVisible();
  });

  test('should show loading indicator while system certificates are being fetched', async ({
    page,
  }) => {
    let resolveRequest: () => void = () => {};
    const requestGate = new Promise<void>((r) => {
      resolveRequest = r;
    });
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await requestGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText(/Loading certificates/i)).toBeVisible();
    resolveRequest();
    await expect(page.getByText('No certificates found.')).toBeVisible();
  });

  test('should show empty state when API returns no certificates', async ({ page }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('No certificates found.')).toBeVisible();
  });

  test('should show error state when system certificates API fails', async ({ page }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' }),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText(/Failed to load certificates/i)).toBeVisible();
  });

  test('should display certificate cards when API returns certificates', async ({ page }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'native-test-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('native-test-cert').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Details' }).first()).toBeVisible();
  });

  test('should show alias type subject issuer validity and fingerprint on each certificate card', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'card-fields-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('card-fields-cert').first()).toBeVisible();
    await expect(page.getByText('Subject:', { exact: false })).toBeVisible();
    await expect(page.getByText('Issuer:', { exact: false })).toBeVisible();
    await expect(page.getByText('Valid From:', { exact: false })).toBeVisible();
    await expect(page.getByText('Valid To:', { exact: false })).toBeVisible();
    await expect(page.getByText('Fingerprint', { exact: false })).toBeVisible();
  });

  test('should show View Details button on each native store certificate card', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'view-details-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByRole('button', { name: 'View Details' }).first()).toBeVisible();
  });

  test('should not show Edit Alias or Remove buttons on native store certificate cards', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'no-edit-remove-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByRole('button', { name: 'Edit Alias' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('should display status pill on each certificate card showing Valid Expired Expires in N days or Valid in N days', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'status-pill-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('status-pill-cert').first()).toBeVisible();
    // Status pill (Chip) appears before "Valid From:" / "Valid To:" in the card; narrow to avoid strict-mode violation
    const card = page.getByRole('tabpanel').locator('[class*="MuiPaper"]').filter({ hasText: 'status-pill-cert' }).first();
    await expect(card.getByText(/Invalid start date|Invalid end date|Expired|Expires in \d+ days|Valid in \d+ days/).or(card.getByText('Valid', { exact: true }))).toBeVisible();
  });

  test('should open certificate details dialog when View Details is clicked', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'details-dialog-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('details-dialog-cert').first()).toBeVisible();
    await page.getByRole('button', { name: 'View Details' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Certificate Details')).toBeVisible();
  });

  test('should show Basic Information Subject Issuer Validity Fingerprint and Certificate Verification in details dialog', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'sections-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('sections-cert').first()).toBeVisible();
    await page.getByRole('button', { name: 'View Details' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Basic Information')).toBeVisible();
    await expect(dialog.getByText('Subject', { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText('Issuer', { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText('Validity Period', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Fingerprint', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Certificate Verification', { exact: false })).toBeVisible();
  });

  test('should close details dialog when Close is clicked', async ({ page }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'close-dialog-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await page.getByRole('button', { name: 'View Details' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should show Verify Certificate button in certificate details dialog', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'verify-btn-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await page.getByRole('button', { name: 'View Details' }).first().click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Verify Certificate' })).toBeVisible();
  });

  test('should filter certificate cards by search input (alias name or subject)', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'alpha-cert', certificate: placeholderCert },
            { alias: 'beta-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('alpha-cert').first()).toBeVisible();
    await expect(panel.getByText('beta-cert').first()).toBeVisible();
    await panel.getByPlaceholder(/search certificates/i).fill('alpha');
    await expect(panel.getByText('alpha-cert').first()).toBeVisible();
    await expect(panel.getByText('beta-cert')).not.toBeVisible();
  });

  test('should show all certificates again when search is cleared', async ({ page }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'clear-a', certificate: placeholderCert },
            { alias: 'clear-b', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    const panel = page.getByRole('tabpanel');
    const searchInput = panel.getByPlaceholder(/search certificates/i);
    await searchInput.fill('clear-a');
    await expect(panel.getByText('clear-b')).not.toBeVisible();
    await searchInput.fill('');
    await expect(panel.getByText('clear-b').first()).toBeVisible({ timeout: 5000 });
  });

  test('should show native tab count matching number of certificates returned by API', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'count-one', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    const tab = page.getByRole('tab', { name: /Native Java Certificate Store/i });
    await expect(tab).toContainText('1');
  });

  test('should load Native Java Certificate Store when navigating directly to tab=native URL', async ({
    page,
  }) => {
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSystemCertificatesResponse([])),
      });
    });
    await gotoNativeTab(page, '?tab=native');
    await expect(page).toHaveURL(/tab=native/);
    await expect(page.getByText('Native Java Certificate Store').first()).toBeVisible();
  });

  test('should allow only viewing and verifying certificates on native tab (read-only)', async ({
    page,
  }) => {
    const placeholderCert = 'YQ==';
    await page.unroute(SYSTEM_CERTIFICATES_ENDPOINT).catch(() => {});
    await page.route(SYSTEM_CERTIFICATES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          buildSystemCertificatesResponse([
            { alias: 'readonly-cert', certificate: placeholderCert },
          ])
        ),
      });
    });
    await gotoNativeTab(page);
    await expect(page.getByText('Read-only system store')).toBeVisible();
    await expect(page.getByText('readonly-cert').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Details' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Alias' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await page.getByRole('button', { name: 'View Details' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Verify Certificate' })).toBeVisible();
  });
});
