/**
 * Vaulter Domain Layer
 *
 * Core domain logic for the state-centric architecture:
 * - types: Scope, Provenance, Lifecycle, Plan, Scorecard
 * - state: Local state read/write
 * - governance: Unified governance checks
 */

// Types
export type {
  Scope,
  Provenance,
  ProvenanceSource,
  ProvenanceOperation,
  Lifecycle,
  ResolvedVariable,
  Plan,
  PlanStatus,
  PlanChange,
  PlanAction,
  PlanSummary,
  Scorecard,
  ScorecardHealth,
  ScorecardIssue,
  ScorecardCategory,
  ServiceStatus,
  DriftStatus,
  PolicyStatus,
  PolicyIssue,
  RequiredStatus,
  RotationStatus,
  RotationOverdueKey,
  WriteResult,
  MoveResult,
  GovernanceResult,
  Inventory,
  InventoryService,
  OrphanedVariable,
  OrphanReason,
  MissingVariable,
  CoverageEntry,
  ProvenanceLogEntry,
  ValueGuardrailCode,
  ValueGuardrailIssue,
  ValueGuardrailStatus
} from './types.js'

export {
  sharedScope,
  serviceScope,
  parseScope,
  scopeToService,
  serviceToScope,
  formatScope,
  scopesEqual,
  serializeScope,
  deserializeScope,
  emptyScorecard,
  emptyPlanSummary,
  emptyGovernanceResult,
  emptyGuardrailStatus
} from './types.js'

// State
export {
  readLocalState,
  writeLocalVariable,
  deleteLocalVariable,
  moveLocalVariable,
  listLocalServices,
  hasLocalState,
  readProvenance,
  getProvenanceCount
} from './state.js'

export type {
  WriteLocalVariableInput
} from './state.js'

// Governance
export {
  checkGovernance,
  checkSingleVariable
} from './governance.js'

// Plan
export {
  computePlan,
  writePlanArtifact,
  readLatestPlan,
  isPlanStale
} from './plan.js'

export type {
  ComputePlanOptions,
  PlanArtifactPaths
} from './plan.js'

// Apply
export {
  executePlan,
  updatePlanArtifact
} from './apply.js'

export type {
  ExecutePlanOptions,
  ApplyResult
} from './apply.js'

// Scorecard
export {
  buildScorecard
} from './scorecard.js'

export type {
  BuildScorecardOptions
} from './scorecard.js'

// Inventory
export {
  buildInventory
} from './inventory.js'

export type {
  BuildInventoryOptions
} from './inventory.js'
