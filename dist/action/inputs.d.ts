/**
 * Vaulter GitHub Action - Input Parser
 *
 * Parses and validates inputs from GitHub Actions environment variables.
 * Inputs are available as INPUT_<NAME> environment variables.
 */
import type { AsymmetricAlgorithm, Environment } from '../types.js';
export type OutputFormat = 'env' | 'json' | 'k8s-secret' | 'k8s-configmap' | 'helm-values' | 'tfvars' | 'shell';
export interface ActionInputs {
    backend: string;
    passphrase: string;
    project: string;
    environment: Environment;
    service?: string;
    outputs: OutputFormat[];
    envPath: string;
    jsonPath: string;
    k8sSecretPath: string;
    k8sConfigMapPath: string;
    helmValuesPath: string;
    tfvarsPath: string;
    shellPath: string;
    k8sSecretName?: string;
    k8sConfigMapName?: string;
    k8sNamespace: string;
    encryptionMode: 'symmetric' | 'asymmetric';
    publicKey?: string;
    privateKey?: string;
    asymmetricAlgorithm: AsymmetricAlgorithm;
    includeShared: boolean;
    exportToEnv: boolean;
    maskValues: boolean;
}
/**
 * Parse and validate all inputs
 */
export declare function getInputs(): ActionInputs;
//# sourceMappingURL=inputs.d.ts.map