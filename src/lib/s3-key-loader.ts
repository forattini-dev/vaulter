/**
 * S3 Key Loader
 *
 * Fetches encryption keys from S3-compatible storage
 * Supports: AWS S3, MinIO, R2, Spaces, B2
 */

/**
 * Parse S3 URL into components
 * Formats supported:
 *   s3://bucket/path/to/key.txt
 *   s3://bucket/path/to/key.txt?region=us-east-1
 *   http://localhost:9000/bucket/path/to/key.txt (MinIO)
 *   https://account.r2.cloudflarestorage.com/bucket/path
 */
export interface S3KeyLocation {
  bucket: string
  key: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export function parseS3Url(url: string): S3KeyLocation {
  const parsed = new URL(url)

  if (parsed.protocol === 's3:') {
    // s3://bucket/path/to/key
    const bucket = parsed.hostname
    const key = parsed.pathname.slice(1) // Remove leading /
    const region = parsed.searchParams.get('region') || undefined

    return { bucket, key, region }
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    // HTTP endpoint (MinIO, R2, etc.)
    // Format: http://host:port/bucket/path or with auth http://key:secret@host/bucket/path
    const endpoint = `${parsed.protocol}//${parsed.host}`
    const pathParts = parsed.pathname.slice(1).split('/')
    const bucket = pathParts[0]
    const key = pathParts.slice(1).join('/')

    return {
      bucket,
      key,
      endpoint,
      accessKeyId: parsed.username || undefined,
      secretAccessKey: parsed.password || undefined
    }
  }

  throw new Error(`Unsupported S3 URL format: ${url}`)
}

/**
 * Fetch a key from S3
 * Uses dynamic import to avoid bundling AWS SDK when not needed
 */
export async function fetchKeyFromS3(location: S3KeyLocation): Promise<string> {
  try {
    // Dynamically import AWS SDK
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')

    // Build client config
    const clientConfig: any = {}

    if (location.region) {
      clientConfig.region = location.region
    }

    if (location.endpoint) {
      clientConfig.endpoint = location.endpoint
      clientConfig.forcePathStyle = true // Required for MinIO/custom endpoints
    }

    if (location.accessKeyId && location.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: location.accessKeyId,
        secretAccessKey: location.secretAccessKey
      }
    }

    const client = new S3Client(clientConfig)

    const command = new GetObjectCommand({
      Bucket: location.bucket,
      Key: location.key
    })

    const response = await client.send(command)

    if (!response.Body) {
      throw new Error('Empty response from S3')
    }

    // Read body as string
    const bodyContents = await response.Body.transformToString()
    return bodyContents.trim()
  } catch (err: any) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
      throw new Error(
        'AWS SDK not installed. To use S3 key source, install: pnpm add @aws-sdk/client-s3'
      )
    }
    throw new Error(`Failed to fetch key from S3: ${err.message}`)
  }
}

/**
 * Load encryption key from S3 URL
 */
export async function loadKeyFromS3(s3Url: string): Promise<string> {
  const location = parseS3Url(s3Url)
  return fetchKeyFromS3(location)
}
