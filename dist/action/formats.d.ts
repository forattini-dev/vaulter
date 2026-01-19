/**
 * Vaulter GitHub Action - Output Format Generators
 *
 * Generates output files in various formats for different IaC tools:
 * - env: Standard .env file
 * - json: JSON key-value pairs
 * - k8s-secret: Kubernetes Secret YAML
 * - k8s-configmap: Kubernetes ConfigMap YAML
 * - helm-values: Helm values.yaml
 * - tfvars: Terraform .tfvars
 * - shell: Shell export script
 */
/**
 * Generate .env file content
 */
export declare function generateEnvFile(vars: Record<string, string>): string;
/**
 * Generate JSON file content
 */
export declare function generateJsonFile(vars: Record<string, string>): string;
/**
 * Generate Kubernetes Secret YAML
 */
export declare function generateK8sSecret(vars: Record<string, string>, options: {
    name: string;
    namespace: string;
    environment: string;
}): string;
/**
 * Generate Kubernetes ConfigMap YAML
 */
export declare function generateK8sConfigMap(vars: Record<string, string>, options: {
    name: string;
    namespace: string;
    environment: string;
}): string;
/**
 * Generate Helm values.yaml
 */
export declare function generateHelmValues(vars: Record<string, string>, options: {
    project: string;
    environment: string;
    service?: string;
}): string;
/**
 * Generate Terraform .tfvars
 */
export declare function generateTfVars(vars: Record<string, string>, options: {
    project: string;
    environment: string;
    service?: string;
}): string;
/**
 * Generate shell export script
 */
export declare function generateShellExport(vars: Record<string, string>): string;
//# sourceMappingURL=formats.d.ts.map