import { describe, expect, it } from 'vitest'
import {
  TAKO_DESKTOP_UPDATE_MIRROR_URL,
  githubFeedUnreachable,
  resolveTakoDesktopUpdateMirrorUrl,
} from '../src/tako-update-feed.ts'

describe('Tako desktop update mirror URL', () => {
  it('defaults to the Tako generic feed with a trailing slash', () => {
    expect(TAKO_DESKTOP_UPDATE_MIRROR_URL).toBe('https://tako.shiroha.tech/dsh/updates/')
    expect(resolveTakoDesktopUpdateMirrorUrl({})).toBe(TAKO_DESKTOP_UPDATE_MIRROR_URL)
    expect(resolveTakoDesktopUpdateMirrorUrl({ DSH_TAKO_UPDATE_MIRROR_URL: ' https://updates.example.test/dsh ' }))
      .toBe('https://updates.example.test/dsh/')
    expect(resolveTakoDesktopUpdateMirrorUrl({ DSH_TAKO_UPDATE_MIRROR_URL: 'https://updates.example.test/dsh/' }))
      .toBe('https://updates.example.test/dsh/')
  })

  it('ignores empty or non-http overrides', () => {
    expect(resolveTakoDesktopUpdateMirrorUrl({ DSH_TAKO_UPDATE_MIRROR_URL: ' ' })).toBe(TAKO_DESKTOP_UPDATE_MIRROR_URL)
    expect(resolveTakoDesktopUpdateMirrorUrl({ DSH_TAKO_UPDATE_MIRROR_URL: 'ftp://updates.example.test/' }))
      .toBe(TAKO_DESKTOP_UPDATE_MIRROR_URL)
  })
})

describe('githubFeedUnreachable', () => {
  it.each([
    ['ETIMEDOUT', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })],
    ['ENOTFOUND', Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })],
    ['ECONNRESET', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
    ['ECONNREFUSED', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['ENETUNREACH', Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' })],
    ['EAI_AGAIN', Object.assign(new Error('getaddrinfo EAI_AGAIN github.com'), { code: 'EAI_AGAIN' })],
    ['net::ERR_', new Error('net::ERR_CONNECTION_TIMED_OUT')],
    ['getaddrinfo', new Error('getaddrinfo failed')],
    ['timed out', new Error('Desktop update connection timed out')],
    ['Cannot find channel', new Error('Cannot find channel "latest.yml" update info on github.com')],
    ['Unable to find latest', new Error('Unable to find latest version on GitHub (https://github.com/tako-dev/dsh-tako-desktop/releases/latest)')],
    ['github 403', Object.assign(new Error('HttpError: 403 Forbidden https://github.com/tako-dev/dsh-tako-desktop'), { statusCode: 403 })],
    ['github 502', Object.assign(new Error('status code 502 from github.com'), { statusCode: 502 })],
    ['github 503', Object.assign(new Error('HttpError: 503 github.com'), { code: 'HTTP_ERROR_503' })],
    ['github 429', Object.assign(new Error('HttpError: 429 github.com'), { statusCode: 429 })],
    ['github 404', new Error('Cannot download from github.com, status code 404')],
    ['nested ENOTFOUND', Object.assign(new Error('Unable to find latest version on GitHub'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' }),
    })],
  ])('treats %s as unreachable', (_label, error) => {
    expect(githubFeedUnreachable(error)).toBe(true)
  })

  it.each([
    ['invalid desktop', new Error('invalid desktop')],
    ['invalid semver', new Error('desktop update: feed version is invalid')],
    ['already latest', new Error('already latest')],
    ['plain 404', new Error('status code 404')],
    ['local generic missing channel', new Error('Cannot find channel "latest.yml" update info')],
    ['signature rejected', new Error('signature rejected')],
    ['offline', new Error('offline')],
  ])('does not treat %s as GitHub unreachability', (_label, error) => {
    expect(githubFeedUnreachable(error)).toBe(false)
  })
})
