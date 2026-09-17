/**
 * End-to-end learning journeys against the PRODUCTION build at a repository
 * subpath.
 *
 * These are the acceptance checks: they drive the app the way a student does,
 * through the real Python worker, with no test hooks into internal state.
 * Booting CPython in wasm is genuinely slow, so the waits here are real cost,
 * not flake padding.
 */
import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'

/** The base path this artifact was built with; the deploy sets it per repo. */
const BASE = process.env.VITE_BASE ?? '/robot-brain-lab/'

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
    // Whatever base this artifact was built with, the app must report it and
    // resolve its runtime under it. Hardcoding one base would only ever test
    // the developer's local choice.
    await expect(page.getByText(BASE, { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`${BASE}runtime/pyodide/$`))).toBeVisible()
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

test.describe('building a method from nothing', () => {
  test('a student can construct charge-total and it passes fresh cases', async ({ page }) => {
    await page.goto('./#/mission/charge-total')
    const editor = page.getByRole('region', { name: /Pip.s method/ })
    await expect(editor).toContainText('Pip has no instructions yet')

    /**
     * Insertion points nest, so a flat nth() would reach inside a loop body.
     * `topLevel` is the list that is a direct child of the editor; `insideLoop`
     * is the one inside the loop's own block.
     */
    const topLevel = editor.locator('> .stmt-list > .stmt-list__items')
    const addFirst = async (list: ReturnType<Page['locator']>, card: RegExp) => {
      await list.locator('xpath=..').locator('> .insert').getByRole('button').click()
      await page.getByRole('button', { name: card }).click()
    }
    const addLast = async (list: ReturnType<Page['locator']>, card: RegExp) => {
      await list.locator('> li').last().locator('> .insert').getByRole('button').click()
      await page.getByRole('button', { name: card }).click()
    }

    // total = 0
    await addFirst(topLevel, /Point a name at something/)
    const first = topLevel.locator('> li').nth(0).locator('.card--bind').first()
    await first.getByLabel('The name to point').fill('total')
    await first.getByRole('button', { name: /a value/ }).click()
    await page.locator('.picker').getByRole('button', { name: 'a number' }).click()
    await page.getByLabel('Which number?').fill('0')
    await page.locator('.picker').getByRole('button', { name: 'Use it' }).click()

    // for charge in charges:
    await addLast(topLevel, /For each item/)
    const loop = editor.locator('.card--for').first()
    await loop.getByRole('button', { name: /a list/ }).click()
    await pickName(page, 'charges')
    await loop.getByLabel('The name for each item').fill('charge')

    // total = total + charge, inside the loop
    const insideLoop = loop.locator('> .card__block > .stmt-list > .stmt-list__items')
    await addFirst(insideLoop, /Point a name at something/)
    const accumulate = insideLoop.locator('.card--bind').first()
    await accumulate.getByLabel('The name to point').fill('total')
    await accumulate.getByRole('button', { name: /a value/ }).click()
    await page.locator('.picker').getByRole('button', { name: 'add or subtract' }).click()
    await accumulate.getByRole('button', { name: /the first number/ }).click()
    await pickName(page, 'total')
    await accumulate.getByRole('button', { name: /the second number/ }).click()
    await pickName(page, 'charge')

    // answer = total, AFTER the loop, not inside it.
    await addLast(topLevel, /Point a name at something/)
    const last = topLevel.locator('> li').last().locator('> .card--bind')
    await last.getByLabel('The name to point').fill('answer')
    await last.getByRole('button', { name: /a value/ }).click()
    await pickName(page, 'total')

    // The Python reveal must be exactly this method, in this order. Checking
    // only that the lines appear would pass a method with the last binding
    // trapped inside the loop, which is a different and wrong method.
    await page.getByRole('button', { name: 'show' }).click()
    // The indent on line 3 is load-bearing: it is what says the accumulation
    // happens inside the loop and the binding on line 4 happens after it.
    await expect(page.locator('.code__lines')).toHaveText(
      ['1', 'total = 0',
        '2', 'for charge in charges:',
        '3', '    total = total + charge',
        '4', 'answer = total'].join(''),
    )

    // And it must survive inputs the student never chose, including empty.
    await page.getByRole('button', { name: /Test it on everything/ }).click()
    await expect(page.locator('.report--good')).toBeVisible({ timeout: 90_000 })
  })
})

test.describe('the interaction paths a student may be limited to', () => {
  test('a manual mission can be driven by keyboard alone', async ({ page }) => {
    await page.goto('./#/mission/shared-list')
    await brainReady(page)

    // Reach the tool by tabbing, and activate it with the keyboard.
    await page.getByRole('button', { name: 'Follow a name' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Getting ready — nothing has happened yet')).toBeVisible()

    // Move into the names region and pick with Enter, no mouse involved.
    await nameTag(page, 'supplies').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Do it', exact: true }).focus()
    await page.keyboard.press('Enter')

    await expect(page.getByText('1 step so far')).toBeVisible()
    await expect(page.locator('[data-brain-key^="work"]')).toHaveCount(1)
  })

  test('arrow keys rove within the names region without leaving it', async ({ page }) => {
    await page.goto('./#/mission/shared-list')
    await brainReady(page)
    await nameTag(page, 'supplies').focus()
    await page.keyboard.press('ArrowDown')
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    expect(focused).toContain('name-tag')
  })
})

test.describe('recovering from trouble', () => {
  test('stopping a runaway method leaves the lab usable and the method intact',
    async ({ page }) => {
      await page.goto('./#/diagnostics')
      await expect(page.getByText(/Python 3\./)).toBeVisible({ timeout: 90_000 })

      await page.getByRole('button', { name: 'Run a runaway loop' }).click()
      await expect(page.getByText(/stopped on the step budget/)).toBeVisible({ timeout: 90_000 })

      await page.getByRole('button', { name: 'Hard stop' }).click()
      // A fresh runtime must come back without a reload.
      await expect(page.getByText(/Python 3\.\d+\.\d+, started in \d+ ms/))
        .toBeVisible({ timeout: 90_000 })
      await page.getByRole('button', { name: 'Run heavy-parcels fixture' }).click()
      await expect(page.getByText('answer → [8, 9]')).toBeVisible({ timeout: 90_000 })
    })

  test('export writes a file and import brings the work back', async ({ page }) => {
    await page.goto('./#/mission/shared-list')
    await brainReady(page)
    await page.getByRole('button', { name: 'Follow a name' }).click()
    await nameTag(page, 'supplies').click()
    await page.getByRole('button', { name: 'Do it', exact: true }).click()
    await expect(page.getByText('1 step so far')).toBeVisible()

    await page.getByRole('button', { name: 'Save file' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export my work' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^robot-brain-lab-\d{4}-\d{2}-\d{2}\.json$/)

    const file = await download.path()
    const bundle = JSON.parse(await readFile(file, 'utf8')) as {
      format: string
      progress: { missionId: string; commands: unknown[] }[]
    }
    expect(bundle.format).toBe('robot-brain-lab/export')
    expect(bundle.progress.find((p) => p.missionId === 'shared-list')!.commands).toHaveLength(1)

    // Now clear the browser's storage and bring the work back from that file.
    await page.evaluate(() => indexedDB.deleteDatabase('robot-brain-lab'))
    await page.reload()
    await brainReady(page)
    await expect(page.getByText('0 steps so far')).toBeVisible()

    await page.getByRole('button', { name: 'Save file' }).click()
    await page.setInputFiles('input[type=file]', file)
    await expect(page.getByText(/Brought back/)).toBeVisible()
    await page.reload()
    await brainReady(page)
    await expect(page.getByText('1 step so far')).toBeVisible()
  })
})

test.describe('every mission loads and is usable', () => {
  // bind-a-name deliberately starts with an empty brain: making the very first
  // object is the mission. The others hand the student a starting state.
  const manual = [
    { id: 'bind-a-name', startsEmpty: true },
    { id: 'shared-list', startsEmpty: false },
    { id: 'rebind-vs-mutate', startsEmpty: false },
    { id: 'swap-keep-the-value', startsEmpty: false },
  ]
  const invent = ['heavy-parcels', 'heavy-parcels-repair', 'charge-total', 'strongest-battery']

  for (const { id, startsEmpty } of manual) {
    test(`${id} starts with a live brain and offers its tools`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`./#/mission/${id}`)
      await expect(page.getByRole('region', { name: /Pip.s brain/ })).toBeVisible()
      await expect(page.locator('.tool').first()).toBeVisible()
      if (startsEmpty) {
        await expect(page.locator('.brain-nothing')).toBeVisible()
      } else {
        // The setup state must actually arrive from Python, not stay empty.
        await expect(page.locator('.brain-nothing')).toBeHidden({ timeout: 90_000 })
        await expect(page.locator('.name-tag').first()).toBeVisible()
      }
      expect(errors).toEqual([])
    })
  }

  for (const id of invent) {
    test(`${id} offers a palette and grades a method`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`./#/mission/${id}`)
      await expect(page.getByRole('region', { name: /Pip.s method/ })).toBeVisible()

      // Every invention mission must offer at least one test case to try.
      await expect(page.locator('#case-pick option').first()).toBeAttached()

      // A method that is not finished must be refused, never silently run.
      const testIt = page.getByRole('button', { name: /Test it on everything/ })
      if (id === 'heavy-parcels-repair') {
        // This one starts complete (but wrong), so it is gradeable at once.
        await expect(testIt).toBeEnabled()
      } else {
        await expect(testIt).toBeDisabled()
        // The editor says why, once. The feedback strip must not repeat it.
        await expect(page.locator('.editor__empty')).toBeVisible()
        await expect(page.locator('.mission__feedback .note')).toHaveCount(0)
      }
      expect(errors).toEqual([])
    })
  }
})
