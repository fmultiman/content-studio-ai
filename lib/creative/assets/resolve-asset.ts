import type { AssetRef, FocalPoint } from '@/lib/schemas/creative/primitives'

export type ResolvedAsset = {
  ref: string
  source: 'fixture'
  path: string
  url: string
  mime_type: string
  width?: number
  height?: number
  checksum?: string
  version?: string
  focal_point?: FocalPoint
  alt?: string
}

type FixtureAsset = Omit<ResolvedAsset, 'ref' | 'focal_point' | 'alt' | 'version' | 'checksum'> & {
  checksum: string
  version: string
}

const FIXTURE_ASSETS: Readonly<Record<string, FixtureAsset>> = {
  'fixture:asset:comunidades-alternativas:logo-v1': {
    source: 'fixture',
    path: 'public/creative-fixtures/comunidades-alternativas-logo-v1.svg',
    url: '/creative-fixtures/comunidades-alternativas-logo-v1.svg',
    mime_type: 'image/svg+xml',
    width: 512,
    height: 512,
    checksum: 'fixture-comunidades-logo-v1',
    version: 'v1',
  },
  'fixture:asset:terra-una:documentary-photo-01': {
    source: 'fixture',
    path: 'public/creative-fixtures/terra-una-documentary-photo-01.svg',
    url: '/creative-fixtures/terra-una-documentary-photo-01.svg',
    mime_type: 'image/svg+xml',
    width: 1080,
    height: 1350,
    checksum: 'fixture-terra-una-photo-01-v1',
    version: 'v1',
  },
  'fixture:asset:acme-labs:hero-01': {
    source: 'fixture',
    path: 'public/creative-fixtures/acme-labs-hero-01.svg',
    url: '/creative-fixtures/acme-labs-hero-01.svg',
    mime_type: 'image/svg+xml',
    width: 1080,
    height: 1920,
    checksum: 'fixture-acme-labs-hero-01-v1',
    version: 'v1',
  },
}

export type AssetResolutionResult =
  | { valid: true; value: ResolvedAsset }
  | {
      valid: false
      error: {
        code: 'asset_not_found' | 'asset_type_not_supported'
        message: string
        path: 'assets'
      }
    }

export function resolveAsset(ref: AssetRef): AssetResolutionResult {
  if (ref.type !== 'fixture') {
    return {
      valid: false,
      error: {
        code: 'asset_type_not_supported',
        message: `Asset type "${ref.type}" is not supported by the local fixture resolver`,
        path: 'assets',
      },
    }
  }

  const fixture = FIXTURE_ASSETS[ref.ref]
  if (!fixture) {
    return {
      valid: false,
      error: {
        code: 'asset_not_found',
        message: `Fixture asset "${ref.ref}" is not registered locally`,
        path: 'assets',
      },
    }
  }

  return {
    valid: true,
    value: {
      ref: ref.ref,
      ...fixture,
      checksum: ref.checksum ?? fixture.checksum,
      version: ref.version ?? fixture.version,
      focal_point: ref.focal_point,
      alt: ref.alt,
    },
  }
}
