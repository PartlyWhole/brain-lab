/**
 * The Memory Sandbox: one screen, real Python behind it.
 *
 * Everything is exercised twice where it matters — once by dragging and once
 * by clicking — because dragging must never be the only way to do something.
 */
import { AxeBuilder } from '@axe-core/playwright'
import type { Result } from 'axe-core'
import { test, expect, type Locator, type Page } from '@playwright/test'

async function ready(page: Page) {
  await page.goto('./sandbox.html')
  await expect(page.locator('.sb__status')).toContainText(/Real Python 3\./, { timeout: 90_000 })
}

/**
 * A drop target may only exist once the drag has begun — the append strip
 * appears while something is in hand — so it is resolved mid-gesture.
 */
async function dragTo(page: Page, source: Locator, target: Locator | (() => Locator)) {
  await source.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  if (!from) throw new Error('drag source has no box')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + from.height / 2 + 24, { steps: 4 })
  const resolved = typeof target === 'function' ? target() : target
  await resolved.waitFor({ state: 'visible' })
  // On a short viewport the target can sit below the fold; a person scrolls to
  // it, and pointer coordinates are viewport-relative, so the test must too.
  await resolved.scrollIntoViewIfNeeded()
  const to = await resolved.boundingBox()
  if (!to) throw new Error('drop target has no box')
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
}

const maker = (page: Page, text: string) => page.locator('.maker__grab', { hasText: text })
const list = (page: Page) => page.locator('.tile[data-type="list"]').first()
const appendStrip = (page: Page) => page.locator('.tile-append').first()
const nameTag = (page: Page, name: string) =>
  page.locator('.name-tag').filter({ hasText: new RegExp(`^${name}`) }).first()

async function nameByDrag(page: Page, target: Locator, name: string) {
  await dragTo(page, maker(page, 'a new name'), target)
  await page.locator('#new-name').fill(name)
  await page.getByRole('button', { name: 'Name it' }).click()
  await expect(nameTag(page, name)).toBeVisible()
}

test.describe('making objects and naming them', () => {
  test('dragging a maker onto the canvas makes a real object', async ({ page }) => {
    await ready(page)
    await expect(page.getByText('Nothing here yet')).toBeVisible()

    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await expect(list(page)).toBeVisible()
    // An empty list shows no slots, and never an empty box standing in for one.
    await expect(page.locator('.tile-empty')).toHaveText('no slots yet')
    await expect(page.locator('.tile-slot')).toHaveCount(0)
    // It exists but has no name yet, and the workspace says exactly that.
    await expect(page.getByText('Made, not named yet')).toBeVisible()
  })

  test('two names on one object converge on a single tile', async ({ page }) => {
    await ready(page)
    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await nameByDrag(page, list(page), 'supplies')
    await nameByDrag(page, list(page), 'bag')

    await expect(page.locator('.tile')).toHaveCount(1)
    await expect(page.locator('.tile-foot')).toContainText('shared ×2')
    // Naming it takes it out of "made, not named yet": it has a name now.
    await expect(page.locator('.work-chip')).toHaveCount(0)
  })

  test('a name that is not a Python name is refused, with the rule', async ({ page }) => {
    await ready(page)
    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await dragTo(page, maker(page, 'a new name'), list(page))
    await page.locator('#new-name').fill('2cool')
    await expect(page.getByRole('button', { name: 'Name it' })).toBeDisabled()
    await expect(page.getByText(/starts with a letter/)).toBeVisible()
  })
})

test.describe('operations', () => {
  test('appending grows the list that both names reach', async ({ page }) => {
    await ready(page)
    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await nameByDrag(page, list(page), 'supplies')
    await nameByDrag(page, list(page), 'bag')

    await maker(page, 'a number').click()
    await expect(page.locator('.work-chip')).toHaveCount(1)
    await dragTo(page, page.locator('.work-chip').first(), () => appendStrip(page))

    await expect(page.locator('.tile[data-type="list"] .tile-slot')).toHaveCount(1)
    // The effect and the result are reported as different things.
    await expect(page.locator('.sb__say')).toContainText('Added one slot')
    await expect(page.locator('.sb__say')).toContainText('gives back None')
  })

  test('replacing one slot is a different operation from appending', async ({ page }) => {
    await ready(page)
    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await nameByDrag(page, list(page), 'xs')
    await maker(page, 'a number').click()
    await dragTo(page, page.locator('.work-chip').first(), () => appendStrip(page))
    await expect(page.locator('.tile-slot')).toHaveCount(1)

    await page.locator('.maker input[aria-label="Which number?"]').fill('99')
    await maker(page, 'a number').click()
    await dragTo(page, page.locator('.work-chip').last(), page.locator('.tile-slot').first())

    // Still one slot: the list was not grown, its one slot now points elsewhere.
    await expect(page.locator('.tile-slot')).toHaveCount(1)
    await expect(page.locator('.tile-slot').first()).toContainText('99')
    await expect(page.locator('.sb__say')).toContainText('same list')
  })

  test('rebinding a name leaves the other name where it was', async ({ page }) => {
    await ready(page)
    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await nameByDrag(page, list(page), 'supplies')
    await nameByDrag(page, list(page), 'bag')

    await maker(page, 'a number').click()
    const number = page.locator('.tile[data-type="int"]').first()
    await dragTo(page, nameTag(page, 'bag'), number)

    await expect(page.locator('.sb__say')).toContainText('Pointed bag')
    // supplies still reaches the list; only bag moved.
    await expect(list(page)).toBeVisible()
    await expect(page.locator('.tile-foot').first()).not.toContainText('shared ×2')
  })

  test('working something out makes a new object and changes neither input',
    async ({ page }) => {
      await ready(page)
      await page.locator('.maker input[aria-label="Which number?"]').fill('2')
      await maker(page, 'a number').click()
      await page.locator('.maker input[aria-label="Which number?"]').fill('3')
      await maker(page, 'a number').click()
      await expect(page.locator('.work-chip')).toHaveCount(2)

      await dragTo(page, page.locator('.work-chip').first(), page.locator('.well').first())
      await dragTo(page, page.locator('.work-chip').nth(1), page.locator('.well').nth(1))
      await page.getByRole('button', { name: 'Work it out' }).click()

      // 2 and 3 are still there, and 5 is new.
      await expect(page.locator('.tile[data-type="int"]')).toHaveCount(3)
      await expect(page.locator('.tile[data-type="int"]').filter({ hasText: '5' })).toBeVisible()
    })
})

test.describe('without dragging', () => {
  test('clicking alone can make, name and append', async ({ page }) => {
    await ready(page)

    // Make by clicking.
    await maker(page, 'an empty list').click()
    await expect(list(page)).toBeVisible()

    // Name by clicking: pick the name up, then click the object.
    await maker(page, 'a new name').click()
    await expect(page.locator('.sb__held')).toContainText('Holding a new name')
    await list(page).locator('.tile-head').click()
    await page.locator('#new-name').fill('xs')
    await page.getByRole('button', { name: 'Name it' }).click()
    await expect(nameTag(page, 'xs')).toBeVisible()

    // Append by clicking: pick the number up, then click the list.
    await maker(page, 'a number').click()
    await page.locator('.work-chip').first().click()
    await expect(page.locator('.sb__held')).toContainText('Holding')
    await list(page).locator('.tile-head').click()
    await expect(page.locator('.tile-slot')).toHaveCount(1)
  })

  test('putting back what is held changes nothing', async ({ page }) => {
    await ready(page)
    await maker(page, 'an empty list').click()
    await maker(page, 'a new name').click()
    await page.getByRole('button', { name: 'Put it back' }).click()
    await expect(page.locator('.sb__held')).toHaveCount(0)
    await expect(page.locator('.name-tag')).toHaveCount(0)
  })
})

test.describe('taking it back', () => {
  test('undo removes the last operation and the diagram agrees', async ({ page }) => {
    await ready(page)
    await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
    await nameByDrag(page, list(page), 'xs')
    await maker(page, 'a number').click()
    await dragTo(page, page.locator('.work-chip').first(), () => appendStrip(page))
    await expect(page.locator('.tile-slot')).toHaveCount(1)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.tile-slot')).toHaveCount(0)
    await expect(nameTag(page, 'xs')).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText('Nothing here yet')).toBeVisible()
  })
})

test('the sandbox has no automated accessibility violations', async ({ page }) => {
  await ready(page)
  await dragTo(page, maker(page, 'an empty list'), page.locator('.brain-canvas'))
  await nameByDrag(page, list(page), 'xs')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((v: Result) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }))).toEqual([])
})
