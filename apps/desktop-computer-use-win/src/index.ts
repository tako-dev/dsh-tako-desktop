/**
 * Observation-only Windows computer use bundle. The Cordis plugin lives in
 * `runtime.ts`; this entry re-exports it so package consumers and the Loader
 * share one surface.
 * @module
 */
export {
  apply,
  Config,
  inject,
  name,
  OBSERVATION_TOOLS,
  publicName,
  refusalReason,
  REFUSED_TOOLS,
  resolveUpstreamServer,
  SERVER_NAME,
  sweepBackendProcesses,
  upstreamName,
  UPSTREAM_PACKAGE,
  UPSTREAM_TOOL_PREFIX,
} from './runtime.ts'
export type { Config as ConfigOptions, ObservationTool, RefusedTool } from './runtime.ts'
