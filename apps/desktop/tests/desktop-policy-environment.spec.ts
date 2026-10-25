import { expect, it } from 'vitest'
import { resolveDesktopPolicyEnvironment } from '../scripts/desktop-policy-environment.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { resolveDesktopPolicyConfig } from '../src/mandatory-update-policy.ts'

const origins = { DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://test.example.com',
  DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://prod.example.com' }
const auth = { DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }) }

it.each(['test', 'production'] as const)('selects the %s policy and authentication together', (deployment) => {
  const policy = resolveDesktopPolicyEnvironment({ ...origins, ...(deployment === 'test' ? auth : {}), DSH_DESKTOP_AUTO_UPDATE_ENV: deployment })
    ?? expect.unreachable('a configured policy resolves')
  const origin = deployment === 'test' ? origins.DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN : origins.DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN
  expect(policy).toEqual({ origin, allowedPageOrigins: [origin],
    ...(deployment === 'test' ? { allowedAuthOrigins: ['https://login.example.com'] } : {}),
    authentication: deployment === 'test' ? 'feishu-test' : 'anonymous' })
  expect(resolveDesktopPolicyConfig(policy)).toMatchObject(policy)
})

it('requires only the selected origin, defaults to test, and accepts explicit page restrictions', () => {
  const policy = resolveDesktopPolicyEnvironment({
    DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: origins.DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN,
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'],
      allowedPageOrigins: ['https://download.example.com'], intervalMs: 5000 }) })
  expect(policy).toMatchObject({ authentication: 'feishu-test', intervalMs: 5000, allowedPageOrigins: ['https://download.example.com'] })
  expect(() => resolveDesktopPolicyEnvironment({ ...origins, DSH_DESKTOP_AUTO_UPDATE_ENV: 'prod' })).toThrow('production')
})

it.each([undefined, '', 'http://test.example.com', 'https://user:secret@test.example.com',
  'https://test.example.com/api', 'https://test.example.com/?secret=value'])('rejects invalid selected origin %s', (origin) => {
  expect(() => resolveDesktopPolicyEnvironment({ ...auth, DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: origin })).toThrow('HTTPS origin')
  expect(() => resolveDesktopPolicyEnvironment({ ...auth, DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: origin })).not.toThrow('secret=value')
})

it.each(['{', 'null', '[]', '{"origin":"https://old.example.com"}', '{"authentication":"anonymous"}',
  '{"allowedPageOrigins":[]}', '{"allowedPageOrigins":["http://example.com"]}'])('rejects invalid or conflicting shared options %s', (options) => {
  expect(() => resolveDesktopPolicyEnvironment({ ...origins, DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: options })).toThrow()
})

it.each([undefined, '[]', '["http://login.example.com"]', '["https://login.example.com/path"]',
  '["https://user:secret@login.example.com"]'])('rejects missing or invalid test login origins %s', (value) => {
  const settings = value === undefined ? {} : { allowedAuthOrigins: JSON.parse(value) as unknown }
  expect(() => resolveDesktopPolicyEnvironment({ ...origins, DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify(settings) })).toThrow()
})

it('rejects login origins in production', () => {
  expect(() => resolveDesktopPolicyEnvironment({ ...origins, ...auth, DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' }))
    .toThrow('must not configure allowedAuthOrigins')
})

it.each([{}, { DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: '  ' },
  { DSH_DESKTOP_AUTO_UPDATE_ENV: 'production', DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://test.example.com' }])(
  'embeds no policy when the selected deployment configures none: %j', (environment) => {
    expect(resolveDesktopPolicyEnvironment(environment)).toBeUndefined()
  })

it('keeps validating a partially configured policy', () => {
  expect(() => resolveDesktopPolicyEnvironment({ ...auth })).toThrow('DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN')
  expect(() => resolveDesktopPolicyEnvironment({ DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://test.example.com' }))
    .toThrow('allowedAuthOrigins')
  expect(() => resolveDesktopPolicyEnvironment({ DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'http://test.example.com' }))
    .toThrow('HTTPS origin')
})

it.each([
  ['win32', { unsigned: true }], ['win32', { prepareOnly: true }], ['darwin', { unsigned: true }],
] as const)('accepts %s configuration without a policy in %j', (platform, options) => {
  expect(() => { validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'com.example.test' }, { platform, arch: 'x64' }, options) })
    .not.toThrow()
})

it.each([{ unsigned: true }, { prepareOnly: true }])('rejects a partial Windows policy in %j', (options) => {
  expect(() => { validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'com.example.test', ...auth }, { platform: 'win32', arch: 'x64' }, options) })
    .toThrow('DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN')
})

it('reaches the signing inputs of a signed release that configures no policy', () => {
  expect(() => { validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'com.example.test' }, { platform: 'win32', arch: 'x64' }) })
    .toThrow('DSH_DESKTOP_WINDOWS_CER_FILE')
  expect(() => { validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'com.example.test' }, { platform: 'darwin', arch: 'arm64' }) })
    .toThrow('DSH_DESKTOP_MACOS_SIGNING_IDENTITY')
})
