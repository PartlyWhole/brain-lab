/**
 * End-to-end learning journeys against the PRODUCTION build at a repository
 * subpath.
 *
 * These are the acceptance checks: they drive the app the way a student does,
 * through the real Python worker, with no test hooks into internal state.
 * Booting CPython in wasm is genuinely slow, so the waits here are real cost,
 * not flake padding.
 */
import { test, expect, type Page } from '@playwright/test'

/** The brain only shows real state once Python has started and replayed. */
async function brainReady(page: Page) {
  await expect(page.getByRole('region', { name: /robot.s brain/i })).toBeVisible()
  await expect(page.getByText('The brain is empty. Nothing has been made yet.'))
    .toBeHidden({ timeout: 90_000 })
}

/** Picks a name from an open expression picker. `weight` must not match
 *  `weights`, so the label is matched exactly. */
async function pickName(page: Page, name: string) {
  const picker = page.locator('.picker')
  await picker.getByRole('button', { name: 'a name' }).click()
  await picker
    .locator('button')
    .filter({ has: page.locator('.picker__label', { hasText: new RegExp(`^${name}$`) }) })
    .click()
  await expect(picker).toBeHidden()
}

/** Clicks a name label in the brain. */
function nameTag(page: Page, name: string) {
  return page.locator('.name-tag').filter({ hasText: new RegExp(`^${name}`) }).first()
}

/** Runs one manual operation: pick the tool, supply inputs, then commit. */
async function useTool(page: Page, tool: string | RegExp) {
  await page.getByRole('button', { name: tool }).click()
  await expect(page.getByText('Getting ready — nothing has happened yet')).toBeVisible()
}

async function commit(page: Page) {
  await page.getByRole('button', { name: 'Do it', exact: true }).click()
  await expect(page.getByText('Getting ready — nothing has happened yet')).toBeHidden()
}

test.describe('getting around', () => {
  test('the mission list loads and links into a mission', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Robot Brain Lab' })).toBeVisible()
    await page.getByRole('link', { name: /One list, two names/ }).click()
    await expect(page).toHaveURL(/#\/mission\/shared-list$/)
    await expect(page.getByText('Two names can point at one list.')).toBeVisible()
  })

  test('a deep link survives a refresh, which is the point of hash routing', async ({ page }) => {
    await page.goto('./#/mission/heavy-parcels')
    await expect(page.getByText('Pip must pick out the heavy parcels')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Pip must pick out the heavy parcels')).toBeVisible()
  })

  test('an unknown mission says so instead of showing a blank page', async ({ page }) => {
    await page.goto('./#/mission/not-a-mission')
    await expect(page.getByText('Pip does not know that mission.')).toBeVisible()
  })

  test('the runtime page reports a real Python version from the subpath', async ({ page }) => {
    await page.goto('./#/diagnostics')
    await expect(page.getByText(/Python 3\.\d+\.\d+, started in \d+ ms/)).toBeVisible({
      timeout: 90_000,
    })
    await expect(page.getByText('/robot-brain-lab/', { exact: true })).toBeVisible()
  })
})

test.describe('a manual mission, end to end', () => {
  test('two names on one list, and a lamp that arrives through both', async ({ page }) => {
    await page.goto('./#/mission/shared-list')
    await brainReady(page)

    // The setup list is there, with two real slots and no spare capacity.
    await expect(nameTag(page, 'supplies')).toBeVisible()
    await expect(page.getByText(/list #1\. 2 slots\./)).toBeAttached()

    // Preparing an operation must not change anything.
    await useTool(page, 'Follow a name')
    await expect(page.getByText(/There is no name bag yet/)).toBeVisible()
    await nameTag(page, 'supplies').click()
    await commit(page)

    // Name the very same object a second time.
    await useTool(page, 'Point a name')
    await page.locator('.work-chip, [data-brain-key^="work"]').first().click()
    await page.getByLabel('What should it be called?').fill('bag')
    await page.getByRole('button', { name: 'Use it' }).click()
    await commit(page)

    await expect(nameTag(page, 'bag')).toBeVisible()
    // One object, two NAMES — not two look-alike tiles, and the count names
    // the kinds of reference rather than lumping the work-area hold in.
    await expect(page.getByText(/2 names.*point here/)).toBeAttached()
    await expect(page.locator('.tile')).toHaveCount(3)   // one list, two texts

    // Put a lamp in through the new name.
    await useTool(page, 'Make some text')
    await page.getByLabel('Which text?').fill('lamp')
    await page.getByRole('button', { name: 'Use it' }).click()
    await commit(page)

    await useTool(page, 'Add to a list')
    await nameTag(page, 'bag').click()
    await page.locator('[data-brain-key^="work"]').last().click()
    await commit(page)

    await expect(page.getByText(/3 slots/).first()).toBeAttached()
    await expect(page.locator('.report--good')).toBeVisible()
  })

  test('undo takes back one step and the brain agrees', async ({ page }) => {
    await page.goto('./#/mission/shared-list')
    await brainReady(page)

    await useTool(page, 'Make some text')
    await page.getByLabel('Which text?').fill('lamp')
    await page.getByRole('button', { name: 'Use it' }).click()
    await commit(page)
    await expect(page.getByText('1 step so far')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('0 steps so far')).toBeVisible()
  })

  test('work survives a reload', async ({ page }) => {
    await page.goto('./#/mission/shared-list')
    await brainReady(page)

    await useTool(page, 'Follow a name')
    await nameTag(page, 'supplies').click()
    await commit(page)
    await useTool(page, 'Point a name')
    await page.locator('[data-brain-key^="work"]').first().click()
    await page.getByLabel('What should it be called?').fill('bag')
    await page.getByRole('button', { name: 'Use it' }).click()
    await commit(page)
    await expect(nameTag(page, 'bag')).toBeVisible()

    await page.reload()
    await brainReady(page)
    await expect(nameTag(page, 'bag')).toBeVisible()
    await expect(page.getByText('2 steps so far')).toBeVisible()
  })
})

test.describe('an invention mission: repair a method that runs but is wrong', () => {
  test('a two-match input exposes the bug, and the repair makes it pass', async ({ page }) => {
    await page.goto('./#/mission/heavy-parcels-repair')

    // The faulty method is already there: result = [weight] inside the if.
    const bug = page.locator('[data-card-id="hpr-bug"]')
    await expect(bug).toBeVisible()

    await page.getByRole('button', { name: /Test it on everything/ }).click()
    const report = page.locator('.report--bad')
    await expect(report).toBeVisible({ timeout: 90_000 })
    // Not a bare "wrong": the authored explanation of the actual event.
    await expect(report).toContainText(/one-item list/i)

    // Repair: throw the rebinding away and append instead.
    await bug.getByRole('button', { name: 'Remove this instruction' }).click()
    await expect(bug).toBeHidden()

    const thenBlock = page.locator('[data-card-id="hpr-test"] .card__block').first()
    await thenBlock.getByRole('button', { name: 'Add an instruction here' }).first().click()
    await page.getByRole('button', { name: /Add to the end of a list/ }).click()

    const appendCard = thenBlock.locator('.card--append')
    await expect(appendCard).toBeVisible()

    // Fill "add <what> to the end of <which list>". Choices are made inside the
    // picker popover, which is scoped explicitly: the same words appear on
    // chips elsewhere in the method.
    await appendCard.getByRole('button', { name: /what to add/ }).click()
    await pickName(page, 'weight')

    await appendCard.getByRole('button', { name: /the list/ }).click()
    await pickName(page, 'result')

    await page.getByRole('button', { name: /Test it on everything/ }).click()
    await expect(page.locator('.report--good')).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('.report--good')).toContainText('It works on every case')
  })

  test('the code reveal matches the repaired method and highlights the running line',
    async ({ page }) => {
      await page.goto('./#/mission/heavy-parcels-repair')
      await page.getByRole('button', { name: 'show' }).click()

      const code = page.locator('.code')
      await expect(code).toContainText('for weight in weights:')
      await expect(code).toContainText('if weight > limit:')
      // The reveal shows the method as it actually is, bug included.
      await expect(code).toContainText('result = [weight]')

      // Run one case and step: the current line must be marked.
      await page.getByRole('button', { name: /^Try it$/ }).click()
      await expect(page.getByText(/Step 1 of \d+/)).toBeVisible({ timeout: 90_000 })
      await expect(page.locator('.code__line--current')).toHaveCount(1)
      await page.getByRole('button', { name: 'Step ▶' }).click()
      await expect(page.locator('.code__line--current')).toHaveCount(1)
    })
})
