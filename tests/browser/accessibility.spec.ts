/**
 * Automated accessibility checks.
 *
 * These catch the mechanical failures — contrast, names, roles, landmarks.
 * They do not establish that the lab is usable by a child with a screen
 * reader; the keyboard journeys in journeys.spec.ts and manual review cover
 * what an automated pass cannot see. Failures are reported in full rather than
 * counted, so a regression names the element it broke.
 */
import { AxeBuilder } from '@axe-core/playwright'
import type { Result, NodeResult } from 'axe-core'
import { test, expect, type Page } from '@playwright/test'

async function audit(page: Page, context?: string) {
  const builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  const results = await (context ? builder.include(context) : builder).analyze()
  return results.violations.map((v: Result) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n: NodeResult) => n.target.join(' ')).slice(0, 4),
  }))
}

test('the mission list has no automated violations', async ({ page }) => {
  await page.goto('./lessons.html')
  await expect(page.getByRole('heading', { name: 'Robot Brain Lab' })).toBeVisible()
  expect(await audit(page)).toEqual([])
})

test('a manual mission with a live brain has no automated violations', async ({ page }) => {
  await page.goto('./lessons.html#/mission/shared-list')
  await expect(page.getByText('The brain is empty. Nothing has been made yet.'))
    .toBeHidden({ timeout: 90_000 })
  expect(await audit(page)).toEqual([])
})

test('an invention mission with the editor and code reveal open has none', async ({ page }) => {
  await page.goto('./lessons.html#/mission/heavy-parcels-repair')
  await page.getByRole('button', { name: 'show' }).click()
  await expect(page.locator('.code')).toBeVisible()
  expect(await audit(page)).toEqual([])
})

test('every interactive control can be reached and named', async ({ page }) => {
  await page.goto('./lessons.html#/mission/heavy-parcels-repair')
  // Nothing may be focusable-but-nameless: that is a control a screen reader
  // announces as "button" and nothing else.
  const nameless = await page.evaluate(() => {
    const focusable = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, [tabindex]:not([tabindex="-1"])',
    )
    const bad: string[] = []
    focusable.forEach((el) => {
      const label = (
        el.getAttribute('aria-label') ??
        el.textContent ??
        (el as HTMLInputElement).placeholder ??
        ''
      ).trim()
      const labelled = el.getAttribute('aria-labelledby')
      if (!label && !labelled) bad.push(el.outerHTML.slice(0, 120))
    })
    return bad
  })
  expect(nameless).toEqual([])
})

test('turning the text size up does not break the brain layout', async ({ page }) => {
  await page.goto('./lessons.html#/mission/shared-list')
  await expect(page.getByText('The brain is empty. Nothing has been made yet.'))
    .toBeHidden({ timeout: 90_000 })

  const boxesAt = async () => {
    const scope = await page.locator('.brain-scope').first().boundingBox()
    const tag = await page.locator('.name-tag').first().boundingBox()
    return { scope: scope!, tag: tag! }
  }

  const before = await boxesAt()
  expect(before.scope.y + before.scope.height).toBeLessThanOrEqual(before.tag.y + 1)

  // Turn it all the way up.
  for (let i = 0; i < 8; i += 1) {
    const button = page.getByRole('button', { name: 'A+' })
    if (await button.isDisabled()) break
    await button.click()
  }
  await expect(page.getByRole('button', { name: 'A+' })).toBeDisabled()

  const after = await boxesAt()
  // The brain really did get bigger...
  expect(after.tag.height).toBeGreaterThan(before.tag.height)
  // ...and the scope label still does not overlap the first name tag.
  expect(after.scope.y + after.scope.height).toBeLessThanOrEqual(after.tag.y + 1)
  // No horizontal page scrollbar at the largest size.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  expect(await audit(page)).toEqual([])
})
