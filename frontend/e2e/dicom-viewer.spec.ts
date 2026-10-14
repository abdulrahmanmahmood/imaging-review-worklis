import { expect, test, type Page } from '@playwright/test';

type ViewerStats = {
  engines: number;
  toolGroups: number;
  resizeObservers: number;
  voiListeners: number;
};

const zeroStats: ViewerStats = {
  engines: 0,
  toolGroups: 0,
  resizeObservers: 0,
  voiListeners: 0,
};

async function openStudy(page: Page, id: string) {
  await page.getByRole('button', { name: id, exact: true }).click();
}

async function waitForImage(page: Page) {
  await expect(page.getByTestId('viewer-dimensions')).toContainText('×');
  const canvas = page.getByTestId('viewer-canvas').locator('canvas');
  await expect(canvas).toBeVisible();
  return canvas;
}

async function getViewerStats(page: Page): Promise<ViewerStats> {
  return page.evaluate(() =>
    structuredClone(
      (window as unknown as { __viewerStats: ViewerStats }).__viewerStats,
    ),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'study-001', exact: true })).toBeVisible();
});

test('renders both valid fixtures, adjusts and resets VOI, resizes, and recovers from corrupt DICOM', async ({
  page,
}) => {
  await openStudy(page, 'study-001');
  const gradientCanvas = await waitForImage(page);
  const gradientPixels = await gradientCanvas.screenshot();
  expect(gradientPixels.byteLength).toBeGreaterThan(1_000);

  const sliders = page.getByRole('slider');
  const widthSlider = sliders.nth(0);
  const centerSlider = sliders.nth(1);
  const initialWidth = await widthSlider.inputValue();
  const initialCenter = await centerSlider.inputValue();
  const widthMax = await widthSlider.getAttribute('max');
  const centerMin = await centerSlider.getAttribute('min');
  expect(widthMax).not.toBeNull();
  expect(centerMin).not.toBeNull();

  await widthSlider.fill(widthMax!);
  await centerSlider.fill(centerMin!);
  expect(await widthSlider.inputValue()).not.toBe(initialWidth);
  expect(await centerSlider.inputValue()).not.toBe(initialCenter);

  await page.getByRole('button', { name: 'Fit / Reset' }).click();
  await expect(widthSlider).toHaveValue(initialWidth);
  await expect(centerSlider).toHaveValue(initialCenter);

  const viewerContainer = page
    .getByTestId('viewer-canvas')
    .locator('..');
  const heightBefore = (await viewerContainer.boundingBox())?.height;
  await viewerContainer.evaluate((element) => {
    element.style.height = '520px';
  });
  await expect
    .poll(async () => (await viewerContainer.boundingBox())?.height)
    .toBe(520);
  expect((await viewerContainer.boundingBox())?.height).not.toBe(heightBefore);

  await openStudy(page, 'study-002');
  const checkerboardCanvas = await waitForImage(page);
  const checkerboardPixels = await checkerboardCanvas.screenshot();
  expect(checkerboardPixels.byteLength).toBeGreaterThan(1_000);
  expect(checkerboardPixels.equals(gradientPixels)).toBe(false);

  await openStudy(page, 'study-003');
  await expect(page.getByText(/DICOM file could not be decoded/)).toBeVisible();

  await openStudy(page, 'study-001');
  await waitForImage(page);
  await expect(page.getByText(/DICOM file could not be decoded/)).toHaveCount(0);
});

test('prevents delayed old images from replacing the active study', async ({ page }) => {
  let releaseOldRequest!: () => void;
  let routeArrivedResolve!: () => void;
  const routeArrived = new Promise<void>((resolve) => {
    routeArrivedResolve = resolve;
  });
  let oldRequestFinishedResolve!: () => void;
  const oldRequestFinished = new Promise<void>((resolve) => {
    oldRequestFinishedResolve = resolve;
  });

  await page.route('**/api/studies/study-001/file', async (route) => {
    routeArrivedResolve();
    await new Promise<void>((resolve) => {
      releaseOldRequest = resolve;
    });
    const response = await route.fetch();
    await route.fulfill({ response });
    oldRequestFinishedResolve();
  });

  await openStudy(page, 'study-001');
  await routeArrived;
  await expect(page.getByText('Loading DICOM image…')).toBeVisible();

  await openStudy(page, 'study-002');
  const activeCanvas = await waitForImage(page);
  const activePixels = await activeCanvas.screenshot();

  releaseOldRequest();
  await oldRequestFinished;

  await expect(page.getByRole('heading', { name: 'study-002' })).toBeVisible();
  expect((await activeCanvas.screenshot()).equals(activePixels)).toBe(true);
});

test('closing during a delayed load and five reopen cycles leave no viewer resources', async ({
  page,
}) => {
  let releaseRequest!: () => void;
  let requestArrivedResolve!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    requestArrivedResolve = resolve;
  });
  let requestFinishedResolve!: () => void;
  const requestFinished = new Promise<void>((resolve) => {
    requestFinishedResolve = resolve;
  });

  await page.route('**/api/studies/study-001/file', async (route) => {
    requestArrivedResolve();
    await new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const response = await route.fetch();
    await route.fulfill({ response });
    requestFinishedResolve();
  });

  await openStudy(page, 'study-001');
  await requestArrived;
  await openStudy(page, 'study-001');
  await expect(page.getByTestId('viewer-canvas')).toHaveCount(0);
  releaseRequest();
  await requestFinished;
  await expect(page.getByTestId('viewer-canvas')).toHaveCount(0);
  await expect.poll(() => getViewerStats(page)).toEqual(zeroStats);

  await page.unroute('**/api/studies/study-001/file');
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await openStudy(page, 'study-001');
    await waitForImage(page);
    await expect.poll(() => getViewerStats(page)).toEqual({
      engines: 1,
      toolGroups: 1,
      resizeObservers: 1,
      voiListeners: 1,
    });

    await openStudy(page, 'study-001');
    await expect(page.getByTestId('viewer-canvas')).toHaveCount(0);
    await expect.poll(() => getViewerStats(page)).toEqual(zeroStats);
  }
});
