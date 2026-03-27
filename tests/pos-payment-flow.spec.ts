import { test, expect, Page } from '@playwright/test';

const getDialogHandler = () => {
  return (dialog: any) => {
    // If the app uses alert() for errors, we still want to know the message.
    // We don't auto-fail immediately because the app can fall back to receipt modal.
    // Fail later if receipt modal doesn't open.
    // eslint-disable-next-line no-console
    console.log('[dialog]', dialog.type?.() ?? dialog.type, dialog.message?.() ?? dialog.message);
    dialog.accept().catch(() => {});
  };
};

const clickButtonWithText = async (page: Page, label: string | RegExp) => {
  const locator = typeof label === 'string' ? page.getByRole('button', { name: label }) : page.getByRole('button', { name: label });
  await locator.first().click({ timeout: 15_000 });
};

test('POS: Payment modal finalization opens receipt', async ({ page }) => {
  page.on('dialog', getDialogHandler());

  // Helpful for diagnosing unexpected JS crashes.
  page.on('pageerror', (err) => {
    // eslint-disable-next-line no-console
    console.log('[pageerror]', err);
  });

  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[console]', msg.type(), msg.text());
  });

  // 1) Login
  await page.goto('/');

  // Login grid has a user card button with the admin name.
  const adminCard = page.getByRole('button', { name: /Administrador/i });
  if (await adminCard.count()) {
    await adminCard.first().click();
  } else {
    // Fallback: click the first user card button.
    const firstButton = page.getByRole('button').first();
    await firstButton.click();
  }

  // Password modal keypad + Entrar.
  await expect(page.getByText(/Senha/i)).toBeVisible({ timeout: 15_000 });
  const passwordModal = page.locator('div').filter({ hasText: 'Senha' }).first();

  const keypad = ['1', '2', '3', '4'] as const;
  for (const k of keypad) {
    await passwordModal.getByRole('button', { name: new RegExp(`^${k}$`) }).click({ timeout: 10_000 });
  }
  await passwordModal.getByRole('button', { name: /Entrar/i }).click({ timeout: 10_000 });

  // 2) Add items to cart
  const cocaButton = page.getByRole('button', { name: /Coca-Cola/i });
  await cocaButton.first().click();

  // Add Água only if it exists to mimic typical total scenario.
  const aguaButton = page.getByRole('button', { name: /Água/i });
  if (await aguaButton.count()) {
    await aguaButton.first().click();
  }

  // 3) Open payment modal
  await clickButtonWithText(page, /Pagamento/i);

  // 4) Fill payment amount depending on modal mode
  const modalRoot = page.getByRole('heading', { name: /Finalizar Pagamento/i }).first().locator('xpath=ancestor::*[contains(@class,"max-w")][1]');
  // If animation is still running, ensure modal root is attached.
  await expect(modalRoot).toBeVisible({ timeout: 15_000 });

  const adicionarBtn = modalRoot.getByRole('button', { name: /Adicionar/i }).first();
  const isMultiplePayment = (await adicionarBtn.count()) > 0;

  if (isMultiplePayment) {
    // Multiple payment mode: enter amount and click "Adicionar"
    const amountInput = modalRoot.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible({ timeout: 10_000 });
    await amountInput.fill('999');
    await adicionarBtn.click({ force: true, timeout: 15_000 });
  } else {
    // Single payment mode: choose "Dinheiro" and enter received amount
    const dinBtn = modalRoot.getByRole('button', { name: /Dinheiro/i }).first();
    await expect(dinBtn).toBeVisible({ timeout: 15_000 });
    await dinBtn.click({ force: true, timeout: 15_000 });

    await page.waitForTimeout(800);
    const trocoCount = await modalRoot.getByText(/Troco:/i).count();
    const numberInputsCount = await modalRoot.locator('input[type="number"]').count();
    // eslint-disable-next-line no-console
    console.log('[debug-payment]', { trocoCount, numberInputsCount });

    const receivedInput = modalRoot.locator('input[type="number"]').first();
    await expect(receivedInput).toBeVisible({ timeout: 10_000 });
    await receivedInput.fill('999');
  }

  // 6) Finalize
  const finalizeBtn = modalRoot.getByRole('button', { name: /Finalizar/i });
  await expect(finalizeBtn).toBeVisible({ timeout: 10_000 });
  await expect(finalizeBtn).toBeEnabled({ timeout: 15_000 });
  await finalizeBtn.click();

  // 7) Receipt modal should appear
  const imprintBtn = page.getByRole('button', { name: /Imprimir/i });
  await expect(imprintBtn).toBeVisible({ timeout: 15_000 });
});

