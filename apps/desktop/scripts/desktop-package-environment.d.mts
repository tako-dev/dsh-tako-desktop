/** Select local test defaults or platform release settings without changing the caller's environment. */

/**
 * Select local macOS test defaults without inheriting release settings.
 * A present `.env.macos` contributes only the download and tuning fields an unsigned build consumes;
 * its release and signing settings are ignored, and a missing file keeps the configuration-free defaults.
 * @param environment Parent environment, retained for build tools and networking.
 * @param appRoot Desktop application directory whose optional `.env.macos` supplies local download settings.
 * @returns Unsigned build environment with the DSH Tako application identifier and no update policy.
 */
export function localMacOSPackageEnvironment(environment?: NodeJS.ProcessEnv, appRoot?: string): NodeJS.ProcessEnv

/**
 * Read a machine preset when selected, otherwise the target's required dotenv; no ambient release fallback.
 * PACKAGE_TEST_RELEASE_ID overrides the test preset only; blank retains its configured ID.
 * @param platform Target platform.
 * @param environment Parent environment, retained only for unrelated build tools.
 * @param appRoot Desktop application directory; relative credential paths resolve here.
 * @param options Unsigned presets and Windows preparation-only presets never read signing credentials.
 * @returns Isolated environment with file-owned release settings.
 */
export function loadDesktopPackageEnvironment(
  platform: 'win32' | 'darwin',
  environment?: NodeJS.ProcessEnv,
  appRoot?: string,
  options?: { unsigned?: boolean, prepareOnly?: boolean },
): NodeJS.ProcessEnv

/**
 * Validate the packaging mode before preparation without invoking a token or Apple's services.
 * @param environment Selected local defaults or file-owned release settings.
 * @param target Selected release target.
 * @param options Explicit packaging mode.
 * @returns Nothing.
 */
export function validateDesktopPackageEnvironment(
  environment: NodeJS.ProcessEnv,
  target: { platform: 'win32' | 'darwin', arch: string },
  options?: { unsigned?: boolean, prepareOnly?: boolean, skipNotarization?: boolean },
): void
