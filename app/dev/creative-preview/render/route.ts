import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextResponse } from 'next/server'
import { authoringRenderRequestSchema } from '@/lib/creative/authoring/render-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const routeDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(routeDir, '..', '..', '..', '..')
const runner = path.join(repoRoot, 'scripts', 'creative', 'run-authoring-render.mjs')

function runLocalRenderer(input: unknown): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    // Fixed executable + fixed script; request data is sent over stdin only.
    const child = spawn(process.execPath, [runner], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: 'development' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      code: code ?? 1,
    }))
    child.stdin.end(JSON.stringify(input))
  })
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'This bridge is available only in local development.' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const parsed = authoringRenderRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid authoring render request.', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const result = await runLocalRenderer(parsed.data)
    if (result.code !== 0) {
      return NextResponse.json({ error: 'Local render failed.', details: result.stderr.slice(-4000) }, { status: 500 })
    }
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
    const output = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>
    const fs = await import('node:fs/promises')
    const absoluteOutput = path.join(repoRoot, String(output.output_path))
    const image = await fs.readFile(absoluteOutput)
    return NextResponse.json({ ...output, image_data_url: `data:image/png;base64,${image.toString('base64')}` })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Local render failed.' }, { status: 500 })
  }
}
