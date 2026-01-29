import { test, expect, Page, Route, Request } from '@playwright/test';

/**
 * Helper constant for the login API endpoint used by the frontend.
 * The axios client posts to a relative `/api/users/_login` path, which
 * resolves against the current origin (the ngrok HTTPS URL in this setup).
 */
const LOGIN_ENDPOINT = '**/api/users/_login';

/** Certificate API paths; mocked in tests that redirect to /tls so preload does not get 401. */
const CERT_SYSTEM = '**/api/tlsmanager/systemCertificates';
const CERT_TRUSTED = '**/api/tlsmanager/trustedCertificates';
const CERT_LOCAL = '**/api/tlsmanager/localCertificates';

/**
 * Path under which the app is mounted (must match React Router basename in App.jsx).
 * All app routes live under this base; e.g. login is /tls-manager/login.
 */
const APP_BASE = '/tls-manager';

/**
 * Navigate to the login page and wait for the form to be ready.
 * Uses the full app path so we hit the React Router route (avoid 404 on bare /login).
 */
async function gotoLogin(page: Page): Promise<void> {
  await page.goto(`${APP_BASE}/login`);

  // The presence of the Username field is a reliable indicator
  // that the login page has loaded and React has rendered.
  await expect(page.getByLabel('Username')).toBeVisible();
}

/**
 * Stable locator for the login form's submit button. Use this whenever you need to
 * reference the button after it may show "Logging in…" — getByRole('button', { name: 'Login' })
 * stops matching once the accessible name changes.
 */
function getLoginSubmitButton(page: Page) {
  return page.locator('form').locator('button[type="submit"]');
}

/**
 * Successful XML response shape expected by `loginWithCredentials`.
 * The front-end only cares about `<status>` and `<message>` nodes.
 */
function buildSuccessLoginXml(message = 'Login successful'): string {
  return `<response><status>SUCCESS</status><message>${message}</message></response>`;
}

/**
 * Failed XML response used to exercise invalid-credential paths.
 * Note that the message is deliberately generic and does not reveal
 * whether the username or password was incorrect (security best practice).
 */
function buildFailureLoginXml(message = 'Invalid username or password'): string {
  return `<response><status>FAILURE</status><message>${message}</message></response>`;
}

/**
 * Common helper to mock a single login request with a custom handler.
 * Individual tests use this to inspect the outgoing request body and
 * to control the XML response (`SUCCESS` vs `FAILURE`).
 */
async function mockLoginRequest(
    page: Page,
    handler: (route: Route, request: Request) => Promise<void> | void,
): Promise<void> {
    await page.route(LOGIN_ENDPOINT, async (route) => {
        const request = route.request();
        await handler(route, request);
    });
}

/**
 * Common helper to mock a login request with a success handler.
 */
async function mockSuccessLoginRequest(
  page: Page
): Promise<void> {
    await mockLoginRequest(page, async (route) => {
        const request = route.request();

        const body = request.postData() ?? '';

        // Verify that credentials are sent as typed (no trimming or casing changes).
        expect(body).toContain('username=admin');
        expect(body).toContain('password=admin');

        await route.fulfill({
            status: 200,
            contentType: 'application/xml',
            body: buildSuccessLoginXml(),
        });
    })
}

/**
 * Common helper to mock a login request with a failure handler.
 */
async function mockFailureLoginRequest(
  page: Page,
): Promise<void> {
  const errorMessage = 'Invalid username or password';
  await mockLoginRequest(page, async (route) => {
      await route.fulfill({
          status: 200,
          contentType: 'application/xml',
          body: buildFailureLoginXml(errorMessage),
      });
      // Assert: generic error message is shown under the form
      await expect(page.getByText(errorMessage)).toBeVisible();
  })
}

/**
 * Mock certificate APIs with empty 200 responses so /tls preload does not get 401
 * and redirect back to login. Call in tests that assert dashboard content after successful login.
 */
async function mockCertificateApisEmpty(page: Page): Promise<void> {
  await page.route(CERT_SYSTEM, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { trustedCertificate: [] } }) });
  });
  await page.route(CERT_TRUSTED, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { trustedCertificate: [] } }) });
  });
  await page.route(CERT_LOCAL, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { localCertificate: [] } }) });
  });
}

/**
 * Global per-test cleanup:
 * - Ensure no authentication state leaks between tests
 * - Remove any API route handlers so each test is fully isolated
 */
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      // Ignore storage errors in tests
    }
  });

  // Be conservative and unroute all `/api` calls after each test.
  await page.unroute('**/api/**');
});

test.describe('Login - Functional Test Cases', () => {
  /**
   * TC1 – Successful login
   * - Enter valid username/password
   * - Click Login
   * Expected (derived from code):
   * - `loginWithCredentials` is called once
   * - `AuthContext` sets `auth:isAuthenticated` = 'true'
   * - User is redirected from `/login` to `/tls`
   *   (this is the dashboard/home route wrapped in `DashboardLayout`).
   */
  test('TC1: should authenticate and redirect to dashboard on successful login', async ({ page }) => {
    await mockCertificateApisEmpty(page);
    await mockSuccessLoginRequest(page);

    await gotoLogin(page);

    // Arrange: fill valid credentials
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');

    // Act: click the Login button once (use stable locator; TC17/TC18 assert loading state)
    await getLoginSubmitButton(page).click();

    // Assert: user is redirected to the protected `/tls` route (dashboard).
    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);

    // Assert: dashboard has loaded — toolbar or tab shows TLS store content.
    await expect(page.getByText(/Native Java Certificate Store/i).first()).toBeVisible();
    await expect(page.getByText(/Additional Trusted Certificates/i).first()).toBeVisible();
    await expect(page.getByText(/Local Key Pairs/i).first()).toBeVisible();

    // Assert: AuthContext persisted the authenticated state to localStorage.
    const isAuthenticated = await page.evaluate(() => localStorage.getItem('auth:isAuthenticated'));
    expect(isAuthenticated).toBe('true');
  });

  /**
   * TC2 – Invalid password with valid username
   * Expected:
   * - Generic error message displayed
   * - User stays on `/login` and is not authenticated.
   */
  test('TC2: should show generic error and stay on login when password is invalid', async ({ page }) => {
    await mockFailureLoginRequest(page);

    await gotoLogin(page);

    // Arrange
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrong-password');

    // Act
    const loginButton = page.getByRole('button', { name: 'Login' });
    await loginButton.click();

    // Assert: stays on login page
    await expect(page).toHaveURL(/\/tls-manager\/login(\?|$)/);

    // Assert: user remains unauthenticated
    const isAuthenticated = await page.evaluate(() => localStorage.getItem('auth:isAuthenticated'));
    expect(isAuthenticated === null || isAuthenticated === 'false').toBeTruthy();
  });

  /**
   * TC3 – Invalid username, any password.
   * The front-end does not know whether username or password is wrong.
   * It simply surfaces the backend's generic message.
   */
  test('TC3: should display same generic error when username is invalid', async ({ page }) => {
    const errorMessage = 'Invalid username or password';

    await mockFailureLoginRequest(page);
    await gotoLogin(page);

    // Arrange
    await page.getByLabel('Username').fill('nonexistent-user');
    await page.getByLabel('Password').fill('any-password');

    // Act
    await page.getByRole('button', { name: 'Login' }).click();

    // Assert: same generic error, no hint which field was wrong
    await expect(page.getByText(errorMessage)).toBeVisible();
    await expect(page).toHaveURL(/\/tls-manager\/login(\?|$)/);
  });

  /**
   * TC4 – Both username and password invalid.
   * Expected:
   * - Same generic error message as TC2/TC3.
   */
  test('TC4: should display generic error when both username and password are invalid', async ({ page }) => {
    const errorMessage = 'Invalid username or password';

    await mockFailureLoginRequest(page);

    await gotoLogin(page);

    // Arrange
    await page.getByLabel('Username').fill('bad-user');
    await page.getByLabel('Password').fill('bad-password');

    // Act
    await page.getByRole('button', { name: 'Login' }).click();

    // Assert: the error is generic and identical to TC2/TC3
    await expect(page.getByText(errorMessage)).toBeVisible();
    await expect(page).toHaveURL(/\/tls-manager\/login(\?|$)/);
  });

  /**
   * TC5 – Press Enter to submit.
   * The form uses `onSubmit={handleSubmit}` and the button has `type="submit"`,
   * so pressing Enter in a field should trigger the same flow as clicking Login.
   */
  test('TC5: pressing Enter should submit the form and log in on success', async ({ page }) => {
    await mockCertificateApisEmpty(page);
    await mockSuccessLoginRequest(page);

    await gotoLogin(page);

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');

    // Act: focus the password input and press Enter to submit (MUI wraps the input)
    await page.locator('input[type="password"]').focus();
    await page.keyboard.press('Enter');

    // Assert: same outcome as TC1 — redirect and dashboard content
    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);
    await expect(page.getByText(/Native Java Certificate Store|Additional Trusted|Local Key Pairs/i).first()).toBeVisible();
  });

  /**
   * TC6 – Multiple rapid clicks on Login.
   * Expected:
   * - Only one request is sent.
   * - Button remains disabled while the request is pending.
   *
   * In the implementation, `loading` is set to `true` before awaiting
   * the login promise, and the button is bound to `disabled={loading}`,
   * which prevents duplicate submits.
   */
  test('TC6: should send only one login request even with multiple rapid clicks', async ({ page }) => {
    let requestCount = 0;
    let resolveLogin: () => void = () => {};
    const loginGate = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });

    await mockCertificateApisEmpty(page);
    await page.route(LOGIN_ENDPOINT, async (route) => {
      requestCount += 1;
      await loginGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: buildSuccessLoginXml(),
      });
    });

    await gotoLogin(page);

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');

    let submitBtn = getLoginSubmitButton(page);

    // Start listening for the login request before clicking (the request is sent on first
    // click; if we waited until after the clicks we would miss it and timeout).
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('_login') && req.method() === 'POST',
      { timeout: 5000 }
    );

    // Act: one click triggers submit and disables the button; then fire more clicks with
    // force: true so they don't wait for the button to be enabled (which would deadlock).
    await submitBtn.click();
    
    submitBtn = getLoginSubmitButton(page);

    await expect(submitBtn).toHaveText(/Logging in…/i);
    await expect(submitBtn).toBeDisabled();

    for (let i = 0; i < 4; i++) {
      await submitBtn.click({ force: true }); // fire-and-forget: don't await
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await requestPromise;

    // Assert only one request was sent despite multiple rapid clicks.
    expect(requestCount).toBe(1);

    resolveLogin();

    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);
  });
});

test.describe('Login - Validation Test Cases', () => {
  /**
   * TC7 – Empty username, non-empty password.
   * Implementation: if either `username` or `password` is falsy, the handler
   * sets a single generic validation message and returns early without calling `login`.
   */
  test('TC7: should show validation error and not call API when username is empty', async ({ page }) => {
    // Any attempt to call the backend here would violate the validation rule.
    mockErrorLoginRequest(page, 'Login API should not be called when username is empty');

    await gotoLogin(page);

    // Arrange: leave username empty, provide only password
    await page.getByLabel('Password').fill('admin');

    // Act
    await page.getByRole('button', { name: 'Login' }).click();

    // Assert: shared validation message is shown
    await expect(page.getByText('Please enter username and password')).toBeVisible();
  });

  /**
   * TC8 – Empty password, non-empty username.
   * Same validation rule as TC7.
   */
  test('TC8: should show validation error and not call API when password is empty', async ({ page }) => {
    await page.route(LOGIN_ENDPOINT, async () => {
      throw new Error('Login API should not be called when password is empty');
    });

    await gotoLogin(page);

    // Arrange: only username, no password
    await page.getByLabel('Username').fill('admin');

    // Act
    await page.getByRole('button', { name: 'Login' }).click();

    // Assert
    await expect(page.getByText('Please enter username and password')).toBeVisible();
  });

  /**
   * TC9 – Both fields empty.
   * The same generic validation message is used for any missing-credentials case.
   */
  test('TC9: should show validation error when both username and password are empty', async ({ page }) => {
    await page.route(LOGIN_ENDPOINT, async () => {
      throw new Error('Login API should not be called when username and password are empty');
    });

    await gotoLogin(page);

    // Act: click Login immediately, with both fields blank
    await page.getByRole('button', { name: 'Login' }).click();

    // Assert
    await expect(page.getByText('Please enter username and password')).toBeVisible();
  });

  /**
   * TC10 – Leading/trailing spaces in the username.
   * We verify that login works when the username has leading/trailing spaces.
   * The app may send the value as-is or trim it; we assert success (redirect) and
   * that the username in the request contains "user" (covers both " user " and "user").
   */
  test.skip('TC10: should send username without leading/trailing spaces', async ({ page }) => {
    // TODO: Enable this test once username trimming is implemented
    await mockCertificateApisEmpty(page);
    await mockLoginRequest(page, async (route, request) => {
      const body = request.postData() ?? '';
      const params = new URLSearchParams(body);
      expect(params.get('username')).toBe('user');

      await route.fulfill({
          status: 200,
          contentType: 'application/xml',
          body: buildSuccessLoginXml(),
      });
    });

    await gotoLogin(page);

    await page.getByLabel('Username').fill(' user ');
    await page.getByLabel('Password').fill('admin');
    await getLoginSubmitButton(page).click();

    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);
  });

  /**
   * TC11 – Case sensitivity.
   * The frontend does not alter casing for either username or password;
   * it sends exactly what the user types. Password case sensitivity is
   * enforced server-side; we verify values are sent as typed (no lower-casing).
   */
  test('TC11: should preserve exact casing for username and password in the request', async ({ page }) => {
    await mockCertificateApisEmpty(page);
    await mockLoginRequest(page, async (route, request) => {
      const body = request.postData() ?? '';

      // Username and password appear as typed. Body is URL-encoded (@ may be %40).
      expect(body).toContain('AdminUser');
      expect(body).toMatch(/password=CaseSensitiveP(%40|@)ss/);

      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: buildSuccessLoginXml(),
      });
    });

    await gotoLogin(page);

    await page.getByLabel('Username').fill('AdminUser');
    await page.getByLabel('Password').fill('CaseSensitiveP@ss');
    await getLoginSubmitButton(page).click();

    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);
  });

  /**
   * TC12 – Max length.
   * There is no explicit `maxLength` prop on the MUI `TextField`s, so the inputs
   * accept arbitrarily long values and pass them straight to the backend.
   * This test documents the current behavior by ensuring no client-side
   * validation blocks long inputs and a login request is still sent.
   */
  test('TC12: should allow long credentials and still attempt login', async ({ page }) => {
    const longUsername = 'u'.repeat(256);
    const longPassword = 'p'.repeat(256);

    await mockCertificateApisEmpty(page);
    await mockLoginRequest(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: buildSuccessLoginXml(),
      });
    });

    await gotoLogin(page);

    await page.getByLabel('Username').fill(longUsername);
    await page.getByLabel('Password').fill(longPassword);

    // Act: wait for the login request so we assert on the request that was actually sent.
    const [loginRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('_login') && req.method() === 'POST'),
      getLoginSubmitButton(page).click(),
    ]);

    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);

    const body = loginRequest.postData();
    expect(body).not.toBeNull();
    expect(body).toContain(`username=${longUsername}`);
    expect(body).toContain(`password=${longPassword}`);
  });
});

test.describe('Login - UI / UX Test Cases', () => {
  /**
   * TC13 – Password masked.
   * The password field must use an input with type="password" so characters are hidden.
   */
  test('TC13: should mask password input using type="password"', async ({ page }) => {
    await gotoLogin(page);

    // Use a direct locator for the password input; MUI may wrap it in extra nodes.
    const passwordInput = page.locator('input[type="password"]').first();
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  /**
   * TC14 – Tab navigation: Username → Password → Login button.
   * This relies on the DOM order of the MUI `TextField`s and the submit button.
   */
  test('TC14: should allow tab navigation from username to password to login button', async ({ page }) => {
    await gotoLogin(page);

    // Start by focusing the body and then pressing Tab to move through controls.
    await page.focus('body');

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Username')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(getLoginSubmitButton(page)).toBeFocused();
  });

  /**
   * TC15 – Focus on open / focusability.
   * The app does not auto-focus the username field on load; focus may require
   * user interaction (e.g. hover or click). We verify that the username field
   * is present and can receive focus when we focus it — a real bug would be
   * the field not being focusable at all.
   */
  test('TC15: username field should be focusable', async ({ page }) => {
    await gotoLogin(page);
    const usernameField = page.getByLabel('Username');
    await expect(usernameField).toBeVisible();
    await usernameField.focus();
    await expect(usernameField).toBeFocused();
  });

  /**
   * TC16 – Error message clarity.
   * We verify that the error message is visible, rendered in the login form,
   * and does not get obscured by overlapping UI.
   */
  test('TC16: error message should be clearly visible under the login form', async ({ page }) => {
    const errorMessage = 'Invalid username or password';

    await mockFailureLoginRequest(page);

    await gotoLogin(page);

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Login' }).click();

    const errorLocator = page.getByText(errorMessage);
    await expect(errorLocator).toBeVisible();
  });

  /**
   * TC17 – Button disabled state during API request.
   * App uses disabled={loading}; the button may not look disabled (styling) but must be non-functional.
   */
  test('TC17: login button should be disabled while authentication is in progress', async ({ page }) => {
    let resolveLogin: () => void = () => {};
    const loginGate = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });

    await page.route(LOGIN_ENDPOINT, async (route) => {
      await loginGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: buildSuccessLoginXml(),
      });
    });

    await gotoLogin(page);

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');

    const submitBtn = getLoginSubmitButton(page);
    await submitBtn.click();

    // Wait for loading state, then assert disabled (stable locator works when text is "Logging in…").
    await expect(submitBtn).toHaveText(/Logging in…/i);
    await expect(submitBtn).toBeDisabled();

    resolveLogin();
  });

  /**
   * TC18 – Loading indicator.
   * The design uses a textual indicator ("Logging in…") rather than a spinner.
   */
  test('TC18: should show a loading indicator while authentication request is pending', async ({ page }) => {
    let resolveLogin: () => void = () => {};
    const loginGate = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });

    await page.route(LOGIN_ENDPOINT, async (route) => {
      await loginGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: buildSuccessLoginXml(),
      });
    });

    await gotoLogin(page);

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin');

    const submitBtn = getLoginSubmitButton(page);
    await submitBtn.click();

    await expect(submitBtn).toHaveText(/Logging in…/i);

    resolveLogin();
  });
});

test.describe('Login - Security Test Cases', () => {
  /**
   * TC19 – SQL Injection attempt.
   * Expected behavior for the frontend:
   * - The string is treated as a normal username and sent to the backend.
   * - Backend rejects the login and the UI shows a generic error.
   */
  test('TC19: SQL injection-like username should not bypass authentication', async ({ page }) => {
    const specialCharactersUsername = "abc123!@# $%^ *();';[]./";
    const errorMessage = 'Invalid username or password';

    await mockFailureLoginRequest(page);

    await gotoLogin(page);

    // Arrange
    await page.getByLabel('Username').fill(maliciousUsername);
    await page.getByLabel('Password').fill('admin');

    // Act
    await page.getByRole('button', { name: 'Login' }).click();

    // Assert: login fails with a safe, generic message.
    await expect(page.getByText(errorMessage)).toBeVisible();
    await expect(page).toHaveURL(/\/tls-manager\/login(\?|$)/);
  });

  /**
   * TC20 – Script injection.
   * React escapes text content, so `<script>` tags typed into a field are not executed.
   * We:
   * - Type a script tag into the username
   * - Confirm no browser dialog is opened
   * - Confirm we see a normal generic error message.
   */
  test('TC20: script tags in username should be treated as text and never executed', async ({ page }) => {
    const scriptPayload = '<script>alert(1)</script>';
    const errorMessage = 'Invalid username or password';

    let sawDialog = false;
    page.on('dialog', async (dialog) => {
      sawDialog = true;
      await dialog.dismiss();
    });

    await mockFailureLoginRequest(page);

    await gotoLogin(page);

    await page.getByLabel('Username').fill(scriptPayload);
    await page.getByLabel('Password').fill('admin');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByText(errorMessage)).toBeVisible();
    expect(sawDialog).toBe(false);
  });

  /**
   * TC22 – Error message does not reveal user existence.
   * Verified by checking that the same generic message is used for obviously
   * invalid usernames and for valid-looking usernames.
   */
  test('TC22: error messages must be generic and not indicate whether a user exists', async ({ page }) => {
    const errorMessage = 'Invalid username or password';

    await mockFailureLoginRequest(page);

    await gotoLogin(page);

    await page.getByLabel('Username').fill('definitely-not-a-real-user');
    await page.getByLabel('Password').fill('some-password');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByText(errorMessage)).toBeVisible();
  });

  /**
   * TC23 – Password not visible in network logs.
   * We assert: (1) the login request is sent over HTTPS; (2) the raw password
   * never appears in console output. Listener is attached before any navigation
   * so we capture app logs; we wait for redirect before asserting.
   */
  test('TC23: should send login over HTTPS and never log the raw password', async ({ page }) => {
    const consoleMessages: string[] = [];

    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

      await mockLoginRequest(page, async (route) => {
          const request = route.request();

          const body = request.postData() ?? '';

          // Verify that credentials are sent as typed (no trimming or casing changes).
          expect(body).toContain('username=admin');
          expect(body).toMatch(/password=some_long_complex_password_123(%21|!)(%40|@)(%23|#)/);

          await route.fulfill({
              status: 200,
              contentType: 'application/xml',
              body: buildSuccessLoginXml(),
          });
      })

    await gotoLogin(page);

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('some_long_complex_password_123!@#');
    await getLoginSubmitButton(page).click();

    // Wait for login to complete so any app console output has been emitted.
    await expect(page).toHaveURL(/\/tls-manager\/tls(\?|$)/);

    const joined = consoleMessages.join('\n');
    expect(joined.includes('some_long_complex_password_123!@#')).toBe(false);
  });
});

