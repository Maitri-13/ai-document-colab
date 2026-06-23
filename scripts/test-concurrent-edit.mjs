#!/usr/bin/env node
/**
 * Concurrent edit stress test — simulates two users editing the same section
 * at exactly the same time to trigger optimistic locking.
 *
 * Usage:
 *   node scripts/test-concurrent-edit.mjs <shareToken>
 *
 * Options (env vars):
 *   BACKEND_URL   defaults to http://localhost:3001
 *   ROUNDS        number of race rounds to run (default 3)
 */

import { setTimeout as delay } from 'timers/promises'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001'
const SHARE_TOKEN = process.argv[2]
const ROUNDS = parseInt(process.env.ROUNDS ?? '3', 10)

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const CYAN   = '\x1b[36m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

if (!SHARE_TOKEN) {
  console.error(`${RED}Usage: node scripts/test-concurrent-edit.mjs <shareToken>${RESET}`)
  process.exit(1)
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

function truncate(str, n = 80) {
  if (!str) return '(empty)'
  return str.length > n ? str.slice(0, n) + '…' : str
}

function separator(label = '') {
  const line = '─'.repeat(60)
  if (label) {
    const pad = Math.max(0, (60 - label.length - 2) / 2)
    console.log(`${DIM}${'─'.repeat(Math.floor(pad))} ${label} ${'─'.repeat(Math.ceil(pad))}${RESET}`)
  } else {
    console.log(`${DIM}${line}${RESET}`)
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}CollabDocs — Concurrent Edit Test${RESET}`)
  console.log(`${DIM}Backend : ${BACKEND_URL}`)
  console.log(`Token   : ${SHARE_TOKEN}`)
  console.log(`Rounds  : ${ROUNDS}${RESET}\n`)

  // 1. Fetch document
  const { status: docStatus, body: doc } = await fetchJSON(
    `${BACKEND_URL}/api/documents/${SHARE_TOKEN}`
  )
  if (docStatus !== 200) {
    console.error(`${RED}Failed to fetch document (${docStatus}): ${JSON.stringify(doc)}${RESET}`)
    process.exit(1)
  }

  const section = doc.sections?.find((s) =>
    ['OPEN', 'QUEUED_FOR_REVISION'].includes(s.state)
  )
  if (!section) {
    console.error(
      `${RED}No editable section found.\nDocument state: ${doc.state}\nSections: ${doc.sections?.map((s) => `${s.title} (${s.state})`).join(', ')}${RESET}\n` +
      `\n${YELLOW}Tip: Start writing and wait for at least one section to reach OPEN state.${RESET}`
    )
    process.exit(1)
  }

  console.log(`${BOLD}Document : ${doc.title}${RESET}`)
  console.log(`Section  : "${section.title}"  (state: ${section.state})`)
  console.log(`Content  : ${DIM}${truncate(section.content)}${RESET}\n`)

  const results = { wins: { 'User A': 0, 'User B': 0 }, conflicts: 0, errors: 0 }

  for (let round = 1; round <= ROUNDS; round++) {
    separator(`Round ${round} / ${ROUNDS}`)

    // Re-fetch the section's current version before each round
    const { status: freshStatus, body: freshDoc } = await fetchJSON(
      `${BACKEND_URL}/api/documents/${SHARE_TOKEN}`
    )
    if (freshStatus !== 200) {
      console.error(`${RED}Re-fetch failed (${freshStatus})${RESET}`)
      break
    }
    const freshSection = freshDoc.sections.find((s) => s.id === section.id)
    const currentVersion = freshSection.version

    console.log(`${DIM}Current version: ${currentVersion}${RESET}`)
    console.log(`Firing User A and User B simultaneously…\n`)

    const editContent = (label) =>
      `${freshSection.content ?? 'Base content.'}\n\n— ${label} round ${round} at ${new Date().toISOString()}`

    // Race both requests — Promise.all fires them at the same event-loop tick
    const [rA, rB] = await Promise.all([
      fetchJSON(`${BACKEND_URL}/api/sections/${section.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: editContent('User A'),
          version: currentVersion,
          authorLabel: 'User A',
        }),
      }),
      fetchJSON(`${BACKEND_URL}/api/sections/${section.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: editContent('User B'),
          version: currentVersion,
          authorLabel: 'User B',
        }),
      }),
    ])

    for (const [label, r] of [['User A', rA], ['User B', rB]]) {
      if (r.status === 200) {
        console.log(`  ${GREEN}✔ ${label} — WON${RESET}  (new version: ${r.body.version ?? r.body})`)
        results.wins[label]++
      } else if (r.status === 409) {
        console.log(
          `  ${YELLOW}⚡ ${label} — CONFLICT${RESET}  server version: ${r.body.currentVersion}`
        )
        console.log(
          `     ${DIM}Server content: ${truncate(r.body.currentContent, 100)}${RESET}`
        )
        results.conflicts++
      } else {
        console.log(`  ${RED}✖ ${label} — ERROR ${r.status}${RESET}: ${JSON.stringify(r.body)}`)
        results.errors++
      }
    }

    console.log()

    // Brief pause between rounds so the DB isn't hammered
    if (round < ROUNDS) await delay(400)
  }

  // ── Summary ──
  separator('Results')
  console.log(`\n  ${BOLD}Wins${RESET}`)
  console.log(`    User A : ${results.wins['User A']} / ${ROUNDS}`)
  console.log(`    User B : ${results.wins['User B']} / ${ROUNDS}`)
  console.log(`\n  ${BOLD}Conflicts triggered${RESET} : ${results.conflicts}`)
  if (results.errors > 0) console.log(`  ${RED}Errors${RESET}               : ${results.errors}`)

  const expectedConflicts = ROUNDS
  if (results.conflicts === expectedConflicts) {
    console.log(`\n  ${GREEN}${BOLD}✔ Optimistic locking working correctly${RESET}`)
    console.log(`  ${DIM}Every round had exactly one winner and one conflict.${RESET}`)
  } else if (results.conflicts === 0) {
    console.log(`\n  ${RED}${BOLD}✖ No conflicts detected — locking may be broken${RESET}`)
  } else {
    console.log(`\n  ${YELLOW}${BOLD}⚠ ${results.conflicts} conflicts in ${ROUNDS} rounds — some rounds may have had two winners${RESET}`)
  }
  console.log()
}

main().catch((err) => {
  console.error(`${RED}${err.message}${RESET}`)
  process.exit(1)
})
