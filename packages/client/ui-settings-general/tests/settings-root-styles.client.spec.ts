/** Settings carrier geometry is independent of contributed launcher markup. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')

it('keeps the indicator carrier full-width without inspecting account state', () => {
  expect(css).toMatch(/\.triggerRow\s*\{[^}]*width: 100%;[^}]*margin: 4px 0;/)
  expect(css).not.toContain('data-signed-out')
  expect(css).toMatch(/\.triggerRow\.railRow\s*\{[^}]*width: 36px;/)
})

it('reflows the panel below 768px on every window but Windows custom captions', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 767px)'))
  // The 188px rail must not survive beside a squeezed content column; macOS
  // native buttons draw over the webview, so only the Windows caption bar
  // keeps the wide layout and its exclusion stays in every selector.
  expect(narrow).toContain(':global(html:not([data-windows-titlebar])) .panel')
  expect(narrow).not.toContain("data-platform='darwin'")
})
