#!/usr/bin/env node
/**
 * Guards against re-introducing waitlist DDL in mvp_init (breaks production DBs
 * that only have 20260211100000_vid_u_waitlist_only).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'prisma', 'migrations')

const MVP_INIT = '20260214120000_mvp_init'
const WAITLIST_ONLY = '20260211100000_vid_u_waitlist_only'

const forbiddenInMvpInit = [
  /CREATE\s+TYPE\s+"WaitlistRole"/i,
  /CREATE\s+TABLE\s+"waitlist"/i,
  /CREATE\s+UNIQUE\s+INDEX\s+"waitlist_email_key"/i,
]

function readSql(folder) {
  return readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8')
}

const folders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

if (!folders.includes(WAITLIST_ONLY)) {
  console.error(`Missing required migration folder: ${WAITLIST_ONLY}`)
  process.exit(1)
}

if (!folders.includes(MVP_INIT)) {
  console.error(`Missing required migration folder: ${MVP_INIT}`)
  process.exit(1)
}

const mvpSql = readSql(MVP_INIT)
for (const pattern of forbiddenInMvpInit) {
  if (pattern.test(mvpSql)) {
    console.error(
      `${MVP_INIT}/migration.sql must not recreate waitlist objects (already in ${WAITLIST_ONLY}).`,
    )
    console.error(`Matched forbidden pattern: ${pattern}`)
    process.exit(1)
  }
}

const waitlistSql = readSql(WAITLIST_ONLY)
if (!/CREATE\s+TYPE\s+"WaitlistRole"/i.test(waitlistSql)) {
  console.error(`${WAITLIST_ONLY} must define WaitlistRole.`)
  process.exit(1)
}

if (!/CREATE\s+TABLE\s+"waitlist"/i.test(waitlistSql)) {
  console.error(`${WAITLIST_ONLY} must define waitlist table.`)
  process.exit(1)
}

// Timestamps must stay ordered: waitlist before mvp_init
const waitlistTs = WAITLIST_ONLY.slice(0, 14)
const mvpTs = MVP_INIT.slice(0, 14)
if (waitlistTs >= mvpTs) {
  console.error('Migration timestamps: waitlist-only must sort before mvp_init.')
  process.exit(1)
}

console.log('Prisma migrations OK:', folders.filter((f) => f !== 'migration_lock.toml').join(' → '))
