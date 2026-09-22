/**
 * Phase 2I-B3 — worker MinIO client config tests (Task 14).
 */
import { describe, expect, it } from 'vitest'
import { readMinioClientConfig, buildPutObjectParams } from '@/lib/render-execution/minio-client-config'

const FULL_ENV = {
  CONTENT_STUDIO_MINIO_ENDPOINT: 'http://minio:9000',
  CONTENT_STUDIO_MINIO_BUCKET: 'content-studio',
  CONTENT_STUDIO_MINIO_ACCESS_KEY: 'worker-access-key',
  CONTENT_STUDIO_MINIO_SECRET_KEY: 'worker-secret-key',
}

describe('readMinioClientConfig — env validation', () => {
  it('returns null when nothing is configured', () => {
    expect(readMinioClientConfig({})).toBeNull()
  })

  it('returns null when endpoint is missing', () => {
    const { CONTENT_STUDIO_MINIO_ENDPOINT, ...rest } = FULL_ENV
    void CONTENT_STUDIO_MINIO_ENDPOINT
    expect(readMinioClientConfig(rest)).toBeNull()
  })

  it('returns null when access key is missing', () => {
    const { CONTENT_STUDIO_MINIO_ACCESS_KEY, ...rest } = FULL_ENV
    void CONTENT_STUDIO_MINIO_ACCESS_KEY
    expect(readMinioClientConfig(rest)).toBeNull()
  })

  it('returns null when secret key is missing', () => {
    const { CONTENT_STUDIO_MINIO_SECRET_KEY, ...rest } = FULL_ENV
    void CONTENT_STUDIO_MINIO_SECRET_KEY
    expect(readMinioClientConfig(rest)).toBeNull()
  })

  it('returns null when bucket is missing', () => {
    const { CONTENT_STUDIO_MINIO_BUCKET, ...rest } = FULL_ENV
    void CONTENT_STUDIO_MINIO_BUCKET
    expect(readMinioClientConfig(rest)).toBeNull()
  })

  it('returns a full config when everything is present', () => {
    const config = readMinioClientConfig(FULL_ENV)
    expect(config).not.toBeNull()
    expect(config?.endpoint).toBe('http://minio:9000')
    expect(config?.bucket).toBe('content-studio')
    expect(config?.accessKeyId).toBe('worker-access-key')
    expect(config?.secretAccessKey).toBe('worker-secret-key')
  })

  it('always forces path-style addressing (MinIO requirement)', () => {
    const config = readMinioClientConfig(FULL_ENV)
    expect(config?.forcePathStyle).toBe(true)
  })

  it('defaults region to us-east-1 when not set', () => {
    const config = readMinioClientConfig(FULL_ENV)
    expect(config?.region).toBe('us-east-1')
  })

  it('honors an explicit region override', () => {
    const config = readMinioClientConfig({ ...FULL_ENV, CONTENT_STUDIO_MINIO_REGION: 'eu-west-1' })
    expect(config?.region).toBe('eu-west-1')
  })
})

describe('buildPutObjectParams — upload shape', () => {
  it('always sets Content-Type to video/mp4', () => {
    const params = buildPutObjectParams({ bucket: 'b', key: 'k', sizeBytes: 100, body: 'fake-stream' })
    expect(params.ContentType).toBe('video/mp4')
  })

  it('uses the actual byte size passed in, not a guess', () => {
    const params = buildPutObjectParams({ bucket: 'b', key: 'k', sizeBytes: 172345, body: 'fake-stream' })
    expect(params.ContentLength).toBe(172345)
  })

  it('passes through the exact bucket and key', () => {
    const params = buildPutObjectParams({ bucket: 'content-studio', key: 'users/x/renders/scratch/y/output.mp4', sizeBytes: 1, body: 'x' })
    expect(params.Bucket).toBe('content-studio')
    expect(params.Key).toBe('users/x/renders/scratch/y/output.mp4')
  })

  it('passes the body through unchanged (a stream in the real worker)', () => {
    const body = { fakeStream: true }
    const params = buildPutObjectParams({ bucket: 'b', key: 'k', sizeBytes: 1, body })
    expect(params.Body).toBe(body)
  })
})
