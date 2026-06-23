import { test, expect } from '@playwright/test';

test.describe('Document Creation Flow', () => {
  test('should display home page with CollabDocs header', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('h1')).toContainText('CollabDocs');
    await expect(page.locator('text=AI Author writes. AI Critic reviews. You decide.')).toBeVisible();
  });

  test('should show document type options', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('text=Technical Design Doc')).toBeVisible();
    await expect(page.locator('text=Product Spec')).toBeVisible();
    await expect(page.locator('text=Security Review')).toBeVisible();
    await expect(page.locator('text=Project Plan')).toBeVisible();
    await expect(page.locator('text=Custom').first()).toBeVisible();
  });

  test('should disable generate button when title or brief is empty', async ({ page }) => {
    await page.goto('/');
    
    const generateButton = page.locator('button:has-text("Generate outline")');
    await expect(generateButton).toBeDisabled();
    
    await page.fill('input[placeholder*="Auth Service"]', 'Test Document');
    await expect(generateButton).toBeDisabled();
    
    await page.fill('input[placeholder*="Auth Service"]', '');
    await page.fill('textarea', 'This is a test brief');
    await expect(generateButton).toBeDisabled();
    
    await page.fill('input[placeholder*="Auth Service"]', 'Test Document');
    await expect(generateButton).toBeEnabled();
  });

  test('should select different document types', async ({ page }) => {
    await page.goto('/');
    
    const productSpecButton = page.locator('button:has-text("Product Spec")');
    await productSpecButton.click();
    await expect(productSpecButton).toHaveClass(/border-blue-500/);
    
    const securityReviewButton = page.locator('button:has-text("Security Review")');
    await securityReviewButton.click();
    await expect(securityReviewButton).toHaveClass(/border-blue-500/);
    await expect(productSpecButton).not.toHaveClass(/border-blue-500/);
  });

  test('should create document and generate outline', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Test Document');
    await page.fill('textarea', 'This is a test document for end-to-end testing. It should cover the basic functionality of the application.');
    
    const generateButton = page.locator('button:has-text("Generate outline")');
    await generateButton.click();
    
    await expect(page.locator('text=Generating outline')).toBeVisible();
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    
    const sectionInputs = page.locator('input[class*="rounded-lg border"]');
    await expect(sectionInputs.first()).toBeVisible();
    const count = await sectionInputs.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should allow editing sections in outline step', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Section Edit Test');
    await page.fill('textarea', 'Testing section editing functionality in the outline step.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    
    const firstSectionInput = page.locator('input[class*="rounded-lg border"]').first();
    await firstSectionInput.fill('Modified Section Title');
    await expect(firstSectionInput).toHaveValue('Modified Section Title');
  });

  test('should allow adding new sections', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Add Section Test');
    await page.fill('textarea', 'Testing adding new sections in the outline step.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    
    const sectionInputs = page.locator('input[class*="rounded-lg border"]');
    const initialCount = await sectionInputs.count();
    
    await page.click('text=Add section');
    
    const newCount = await sectionInputs.count();
    expect(newCount).toBe(initialCount + 1);
  });

  test('should proceed to resources step after confirming outline', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Resources Test');
    await page.fill('textarea', 'Testing progression to resources step.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    
    await page.click('button:has-text("Next: Add resources")');
    
    await expect(page.locator('h2:has-text("Add reference files")')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('text=Click to upload')).toBeVisible();
  });

  test('should navigate back from outline to form', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Back Button Test');
    await page.fill('textarea', 'Testing back navigation.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    
    await page.click('button:has-text("← Back")');
    
    await expect(page.locator('h2:has-text("Start a new document")')).toBeVisible();
  });

  test('should complete full flow and start writing', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Full Flow Test');
    await page.fill('textarea', 'Testing the complete document creation flow from start to finish.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    await page.click('button:has-text("Next: Add resources")');
    
    await expect(page.locator('h2:has-text("Add reference files")')).toBeVisible({ timeout: 30000 });
    await page.click('button:has-text("Start writing")');
    
    await expect(page).toHaveURL(/\/doc\//, { timeout: 30000 });
    
    await expect(page.locator('text=Who are you?')).toBeVisible({ timeout: 10000 });
  });

  test('should allow user to enter display name on document page', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Name Entry Test');
    await page.fill('textarea', 'Testing display name entry.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    await page.click('button:has-text("Next: Add resources")');
    await page.click('button:has-text("Start writing")');
    
    await expect(page.locator('text=Who are you?')).toBeVisible({ timeout: 30000 });
    
    await page.fill('input[placeholder="Your name"]', 'Test User');
    await page.click('button:has-text("Enter as Test User")');
    
    await expect(page.locator('text=Who are you?')).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe('Document Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('should show document editor after entering name', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[placeholder*="Auth Service"]', 'E2E Editor Test');
    await page.fill('textarea', 'Testing the document editor view.');
    await page.click('button:has-text("Generate outline")');
    
    await expect(page.locator('h2:has-text("Review outline")')).toBeVisible({ timeout: 60000 });
    await page.click('button:has-text("Next: Add resources")');
    await page.click('button:has-text("Start writing")');
    
    await expect(page.locator('text=Who are you?')).toBeVisible({ timeout: 30000 });
    await page.fill('input[placeholder="Your name"]', 'Editor Test User');
    await page.click('button:has-text("Enter as Editor Test User")');
    
    await expect(page.locator('[class*="prose"]').first()).toBeVisible({ timeout: 30000 });
  });
});
