import cors from 'cors'
import express from 'express'
import fs from 'fs'
import path from 'path'
import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
const dataDir = path.join(__dirname, 'data')
const dbPath = path.join(dataDir, 'blockjartip.sqlite')
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

sqlite3.verbose()
const db = new sqlite3.Database(dbPath)

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error)
        return
      }
      resolve(this)
    })
  })

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error)
        return
      }
      resolve(row)
    })
  })

const normalizeAddress = (value) =>
  typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? value.toLowerCase()
    : null

const normalizeHash = (value) =>
  typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)
    ? value.toLowerCase()
    : null

const isLanOrLocalOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin)

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true
    }

    if (hostname.endsWith('.local')) {
      return true
    }

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!ipv4) return false

    const octets = ipv4.slice(1).map(Number)
    if (octets.some((octet) => octet < 0 || octet > 255)) return false

    const [a, b] = octets
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  } catch {
    return false
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    const isExplicitlyAllowed = corsAllowedOrigins.includes(origin)
    const isLanOrLocal = isLanOrLocalOrigin(origin)

    if (isExplicitlyAllowed || isLanOrLocal) {
      callback(null, true)
      return
    }

    callback(new Error('Origin not allowed by CORS.'))
  },
}

const initDatabase = async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS deployments (
      wallet_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      contract_address TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (wallet_address, chain_id)
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS pending_deployments (
      wallet_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      pending_tx_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (wallet_address, chain_id)
    )
  `)
}

app.use(cors(corsOptions))
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/deployments', async (request, response) => {
  try {
    const chainId = Number(request.query.chainId)
    const walletAddress = normalizeAddress(request.query.walletAddress)

    if (!Number.isInteger(chainId) || !walletAddress) {
      response.status(400).json({ error: 'Invalid query params.' })
      return
    }

    const deployment = await get(
      `SELECT contract_address FROM deployments WHERE wallet_address = ? AND chain_id = ?`,
      [walletAddress, chainId],
    )

    const pending = await get(
      `SELECT pending_tx_hash FROM pending_deployments WHERE wallet_address = ? AND chain_id = ?`,
      [walletAddress, chainId],
    )

    response.json({
      contractAddress: deployment?.contract_address ?? null,
      pendingTxHash: pending?.pending_tx_hash ?? null,
    })
  } catch (error) {
    response.status(500).json({ error: 'Could not read deployment.' })
  }
})

app.put('/api/deployments', async (request, response) => {
  try {
    const chainId = Number(request.body.chainId)
    const walletAddress = normalizeAddress(request.body.walletAddress)
    const contractAddress = normalizeAddress(request.body.contractAddress)

    if (!Number.isInteger(chainId) || !walletAddress || !contractAddress) {
      response.status(400).json({ error: 'Invalid payload.' })
      return
    }

    await run(
      `
        INSERT INTO deployments (wallet_address, chain_id, contract_address)
        VALUES (?, ?, ?)
        ON CONFLICT(wallet_address, chain_id)
        DO UPDATE SET
          contract_address = excluded.contract_address,
          updated_at = CURRENT_TIMESTAMP
      `,
      [walletAddress, chainId, contractAddress],
    )

    await run(
      `DELETE FROM pending_deployments WHERE wallet_address = ? AND chain_id = ?`,
      [walletAddress, chainId],
    )

    response.json({ ok: true })
  } catch {
    response.status(500).json({ error: 'Could not save deployment.' })
  }
})

app.put('/api/pending-deployments', async (request, response) => {
  try {
    const chainId = Number(request.body.chainId)
    const walletAddress = normalizeAddress(request.body.walletAddress)
    const pendingTxHash = normalizeHash(request.body.pendingTxHash)

    if (!Number.isInteger(chainId) || !walletAddress || !pendingTxHash) {
      response.status(400).json({ error: 'Invalid payload.' })
      return
    }

    await run(
      `
        INSERT INTO pending_deployments (wallet_address, chain_id, pending_tx_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(wallet_address, chain_id)
        DO UPDATE SET
          pending_tx_hash = excluded.pending_tx_hash,
          updated_at = CURRENT_TIMESTAMP
      `,
      [walletAddress, chainId, pendingTxHash],
    )

    response.json({ ok: true })
  } catch {
    response.status(500).json({ error: 'Could not save pending deployment.' })
  }
})

app.delete('/api/pending-deployments', async (request, response) => {
  try {
    const chainId = Number(request.query.chainId)
    const walletAddress = normalizeAddress(request.query.walletAddress)

    if (!Number.isInteger(chainId) || !walletAddress) {
      response.status(400).json({ error: 'Invalid query params.' })
      return
    }

    await run(
      `DELETE FROM pending_deployments WHERE wallet_address = ? AND chain_id = ?`,
      [walletAddress, chainId],
    )

    response.json({ ok: true })
  } catch {
    response.status(500).json({ error: 'Could not clear pending deployment.' })
  }
})

initDatabase()
  .then(() => {
    app.listen(port, host, () => {
      console.log(`SQLite API running on http://${host}:${port}`)
      console.log(
        'CORS enabled for localhost and LAN origins. Add CORS_ALLOWED_ORIGINS for custom hosts.',
      )
    })
  })
  .catch((error) => {
    console.error('Failed to initialize SQLite database:', error)
    process.exit(1)
  })
