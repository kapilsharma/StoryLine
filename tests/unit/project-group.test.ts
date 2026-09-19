import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createProject } from '@main/projectService'
import {
  applyGroupScriptToHtml,
  groupManifestSource,
  ProjectGroupError,
  resolveProjectGroup
} from '@main/data/projectGroup'
import { GROUP_GLOBAL, PROJECT_GROUP_SCHEMA_VERSION } from '@shared/projectGroup'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-group-'))
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

/** Write `projectgroup.json` in `base`, defaulting to a valid file. */
async function writeGroupFile(overrides: Record<string, unknown> = {}): Promise<void> {
  await fs.writeFile(
    join(base, 'projectgroup.json'),
    JSON.stringify({
      schemaVersion: PROJECT_GROUP_SCHEMA_VERSION,
      name: 'My Story Universe',
      projects: ['thettana', 'dracula'],
      ...overrides
    }),
    'utf8'
  )
}

describe('resolveProjectGroup', () => {
  it('returns null when the parent folder has no projectgroup.json', async () => {
    const root = join(base, 'thettana')
    await fs.mkdir(root)
    await createProject(root)
    await expect(resolveProjectGroup(root)).resolves.toBeNull()
  })

  it('resolves the manifest from every member’s own project.json, in listed order', async () => {
    const thettana = join(base, 'thettana')
    const dracula = join(base, 'dracula')
    await fs.mkdir(thettana)
    await fs.mkdir(dracula)
    await createProject(thettana)
    await createProject(dracula)
    await writeGroupFile()

    const resolved = await resolveProjectGroup(thettana)
    expect(resolved).not.toBeNull()
    expect(resolved!.manifest).toEqual({
      name: 'My Story Universe',
      members: [
        { folder: 'thettana', name: 'thettana' },
        { folder: 'dracula', name: 'dracula' }
      ]
    })
  })

  it('rejects a group file with an unsupported schemaVersion', async () => {
    const thettana = join(base, 'thettana')
    await fs.mkdir(thettana)
    await createProject(thettana)
    await writeGroupFile({ schemaVersion: 99 })
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(ProjectGroupError)
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/schemaVersion/)
  })

  it('rejects invalid JSON', async () => {
    const thettana = join(base, 'thettana')
    await fs.mkdir(thettana)
    await createProject(thettana)
    await fs.writeFile(join(base, 'projectgroup.json'), '{ not json', 'utf8')
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects an empty "name"', async () => {
    const thettana = join(base, 'thettana')
    await fs.mkdir(thettana)
    await createProject(thettana)
    await writeGroupFile({ name: '' })
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/"name"/)
  })

  it('rejects an empty "projects" list', async () => {
    const thettana = join(base, 'thettana')
    await fs.mkdir(thettana)
    await createProject(thettana)
    await writeGroupFile({ projects: [] })
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/"projects"/)
  })

  it('rejects duplicate folder names in "projects"', async () => {
    const thettana = join(base, 'thettana')
    await fs.mkdir(thettana)
    await createProject(thettana)
    await writeGroupFile({ projects: ['thettana', 'thettana'] })
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/duplicate/)
  })

  it('rejects a listed folder that does not exist', async () => {
    const thettana = join(base, 'thettana')
    await fs.mkdir(thettana)
    await createProject(thettana)
    await writeGroupFile({ projects: ['thettana', 'ghost'] })
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/ghost/)
  })

  it('rejects a listed folder that is not a ZN Story Line project', async () => {
    const thettana = join(base, 'thettana')
    const notAProject = join(base, 'dracula')
    await fs.mkdir(thettana)
    await fs.mkdir(notAProject)
    await createProject(thettana)
    await writeGroupFile()
    await expect(resolveProjectGroup(thettana)).rejects.toThrow(/dracula/)
  })

  it('rejects exporting a project the group file does not itself list', async () => {
    const thettana = join(base, 'thettana')
    const dracula = join(base, 'dracula')
    const togaf = join(base, 'togaf-saga')
    await fs.mkdir(thettana)
    await fs.mkdir(dracula)
    await fs.mkdir(togaf)
    await createProject(thettana)
    await createProject(dracula)
    await createProject(togaf)
    await writeGroupFile() // lists thettana, dracula — not togaf-saga

    await expect(resolveProjectGroup(togaf)).rejects.toThrow(/togaf-saga/)
  })
})

describe('groupManifestSource', () => {
  it('assigns the manifest to window.__ZN_GROUP__ as a script, not JSON', () => {
    const source = groupManifestSource({
      name: 'My Story Universe',
      members: [{ name: 'Thettana', folder: 'thettana' }]
    })
    expect(source).toContain(`window.${GROUP_GLOBAL} = `)
    expect(source).toContain('"Thettana"')
  })
})

describe('applyGroupScriptToHtml', () => {
  const html = '<!doctype html>\n<html lang="en">\n  <head>\n    <title>x</title>\n  </head>\n</html>'

  it('adds a relative include for the shared group.js', () => {
    const out = applyGroupScriptToHtml(html)
    expect(out).toContain('<script src="../group.js"></script>')
  })

  it('is idempotent — re-applying does not duplicate the include', () => {
    const once = applyGroupScriptToHtml(html)
    const twice = applyGroupScriptToHtml(once)
    expect(twice.match(/group\.js/g)).toHaveLength(1)
  })
})
