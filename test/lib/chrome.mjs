// 启动一次性的 headless Chrome:临时 profile、Chrome 自己分配调试端口,
// 跑完连进程组一起清掉。只重试基础设施启动失败,不重试任何产品断言。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from './cdp.mjs'

const CANDIDATES = [
  process.env.CHROME_BIN,
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)

const resolveChrome = () => {
  for (const candidate of CANDIDATES) {
    // 带路径的候选要求文件真的在;裸命令名交给 PATH 解析,启动失败时再报错
    if (!candidate.includes('/') && !candidate.includes('\\')) return candidate
    if (existsSync(candidate)) return candidate
  }

  throw new Error(
    `没找到 Chrome。装一个 Chrome / Chromium,或用 CHROME_BIN 指定可执行文件路径。已尝试:\n  ${CANDIDATES.join('\n  ')}`,
  )
}

const START_TIMEOUT_MS = 20000
const READY_TIMEOUT_MS = 5000
const START_ATTEMPTS = 3

const killTree = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') child.kill('SIGKILL')
    else process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
  await Promise.race([new Promise((done) => child.once('exit', done)), sleep(3000)])
}

const launchAttempt = async (binary, headless, args, attempt) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'zashboard-chrome-'))
  const linuxFlags = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []
  let stderr = ''
  let exitInfo = null
  const child = spawn(
    binary,
    [
      headless ? '--headless=new' : '',
      // 让 Chrome 原子地选一个空闲端口,避开"先检查再绑定"的端口竞态
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      ...linuxFlags,
      // 后台标签页会被降频,基准数据会失真
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      ...args,
      'about:blank',
    ].filter(Boolean),
    { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' },
  )
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000)
  })
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  const cleanup = async () => {
    await killTree(child)
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
  const diagnostics = () =>
    `binary=${binary} attempt=${attempt}/${START_ATTEMPTS} profile=${userDataDir} ` +
    `exit=${exitInfo ? `${exitInfo.code}/${exitInfo.signal}` : 'running'}` +
    (stderr ? `\n${stderr}` : '')

  try {
    const portFile = join(userDataDir, 'DevToolsActivePort')
    const startedAt = Date.now()
    let port = null
    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      if (exitInfo) throw new Error(`Chrome exited before DevTools was ready (${diagnostics()})`)
      if (existsSync(portFile)) {
        const line = readFileSync(portFile, 'utf8').split('\n')[0]?.trim()
        if (/^\d+$/.test(line)) {
          port = Number(line)
          break
        }
      }
      await sleep(100)
    }
    if (!port) {
      throw new Error(
        `DevToolsActivePort did not appear within ${START_TIMEOUT_MS}ms (${diagnostics()})`,
      )
    }

    const readyAt = Date.now()
    let ready = false
    while (Date.now() - readyAt < READY_TIMEOUT_MS) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {}
      if (exitInfo) break
      await sleep(100)
    }
    if (!ready) {
      throw new Error(`DevTools endpoint ${port} did not respond (${diagnostics()})`)
    }

    return { port, close: cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export const launchChrome = async ({ headless = true, args = [] } = {}) => {
  const binary = resolveChrome()
  let lastError
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    try {
      return await launchAttempt(binary, headless, args, attempt)
    } catch (error) {
      lastError = error
      if (attempt < START_ATTEMPTS) await sleep(500)
    }
  }
  throw lastError
}
