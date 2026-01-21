/**
 * Vaulter Runtime Module
 *
 * Load environment variables directly from the backend at application startup,
 * without needing .env files or Kubernetes ConfigMaps/Secrets.
 *
 * ## Quick Start
 *
 * ### Option 1: Side-effect import (simplest)
 * ```typescript
 * // At the very top of your entry file
 * import 'vaulter/runtime/load'
 *
 * // Now process.env has all your secrets
 * ```
 *
 * ### Option 2: Programmatic loading
 * ```typescript
 * import { loadRuntime } from 'vaulter/runtime'
 *
 * await loadRuntime()
 * // or with options
 * await loadRuntime({
 *   environment: 'prd',
 *   service: 'api',
 *   required: true
 * })
 * ```
 *
 * ## Configuration
 *
 * ### Environment Variables
 * ```bash
 * # Backend connection
 * VAULTER_BACKEND=s3://bucket/envs?region=us-east-1
 *
 * # Encryption key (per-environment recommended)
 * VAULTER_KEY_PRD=your-production-key
 * VAULTER_KEY_DEV=your-development-key
 * VAULTER_KEY=fallback-key  # Global fallback
 *
 * # Context
 * VAULTER_PROJECT=myproject
 * VAULTER_SERVICE=api        # For monorepos
 * NODE_ENV=production        # Environment selection
 *
 * # Debug
 * VAULTER_VERBOSE=1
 * VAULTER_SILENT=1
 * ```
 *
 * ### Config File (.vaulter/config.yaml)
 * ```yaml
 * version: "1"
 * project: myproject
 * service: api
 *
 * backend:
 *   url: s3://bucket/envs?region=us-east-1
 *
 * # Encryption keys are auto-detected:
 * # 1. VAULTER_KEY_{ENV} env var (e.g., VAULTER_KEY_PRD) - automatically checked
 * # 2. VAULTER_KEY env var - global fallback
 * # Or configure explicitly:
 * # encryption:
 * #   key_source:
 * #     - env: MY_CUSTOM_KEY_VAR
 *
 * environments:
 *   - dev
 *   - stg
 *   - prd
 * ```
 *
 * ## Kubernetes Usage
 *
 * With runtime loading, you don't need ConfigMaps or Secrets for your app.
 * Just pass the encryption key:
 *
 * ```yaml
 * apiVersion: apps/v1
 * kind: Deployment
 * spec:
 *   template:
 *     spec:
 *       containers:
 *         - name: app
 *           env:
 *             - name: NODE_ENV
 *               value: "production"
 *             - name: VAULTER_KEY_PRD
 *               valueFrom:
 *                 secretKeyRef:
 *                   name: vaulter-key
 *                   key: prd
 * ```
 *
 * The app fetches all other secrets from S3 at startup.
 *
 * @module vaulter/runtime
 */

// Main loader
export { loadRuntime, isRuntimeAvailable, getRuntimeInfo } from './loader.js'

// Types
export type {
  RuntimeLoaderOptions,
  RuntimeLoaderResult,
  ResolvedRuntimeOptions
} from './types.js'
