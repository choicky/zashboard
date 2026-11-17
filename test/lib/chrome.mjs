// 启动一次性的 headless Chrome:临时 profile、Chrome 自己分配调试端口,
// 跑完连进程组一起清掉。只重试基础设施启动失败,不重试任何产品断言。
import { spawn, spawnSync } from 'node:child_process'
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

const isPath = (candidate) => candidate.includes('/') || candidate.includes('\\')

// 按给定顺序检查候选:绝对路径要真实存在,裸命令名要真的能启动。
// 不可用的候选直接跳过,而不是盲目选第一个名字。
const resolveCandidates = () => {
  const usable = []
  for (const candidate of CANDIDATES) {
    if (isPath(candidate)) {
      if (existsSync(candidate)) usable.push(candidate)
      continue
    }
    try {
      const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 })
      if (!probe.error && probe.status === 0) usable.push(candidate)
    } catch {}
  }
  if (!usable.length) {
    throw new Error(
      `没找到可执行的 Chrome。安装 Chrome / Chromium,或用 CHROME_BIN 指定路径。已尝试:\n  ${CANDIDATES.join('\n  ')}`,
    )
  }
  return usable
}

const START_TIMEOUT_MS = 20000
const READY_TIMEOUT_MS = 5000
const START_ATTEMPTS = 3

const killTree = async (child) => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
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

const launchAttempt = async (binary, headless, args, attempt, candidate, candidates) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'zashboard-chrome-'))
  const linuxFlags = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []
  let stderr = ''
  let exitInfo = null
  let spawnError = null
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
  child.once('error', (error) => {
    spawnError = error
  })
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  const cleanup = async () => {
    await killTree(child)
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
  const diagnostics = () =>
    `binary=${binary} attempt=${attempt}/${START_ATTEMPTS} candidate=${candidate}/${candidates} ` +
    `profile=${userDataDir} spawn=${spawnError ? spawnError.message : 'ok'} ` +
    `exit=${exitInfo ? `${exitInfo.code}/${exitInfo.signal}` : 'running'}` +
    (stderr ? `\n${stderr}` : '')

  try {
    const portFile = join(userDataDir, 'DevToolsActivePort')
    const startedAt = Date.now()
    let port = null
    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      if (spawnError) throw new Error(`Chrome spawn failed (${diagnostics()})`)
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
      if (spawnError || exitInfo) break
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {}
      await sleep(100)
    }
    if (!ready) throw new Error(`DevTools endpoint ${port} did not respond (${diagnostics()})`)

    return { port, close: cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export const launchChrome = async ({ headless = true, args = [] } = {}) => {
  const candidates = resolveCandidates()
  let lastError
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    for (const [index, binary] of candidates.entries()) {
      try {
        return await launchAttempt(binary, headless, args, attempt, index + 1, candidates.length)
      } catch (error) {
        lastError = error
      }
    }
    if (attempt < START_ATTEMPTS) await sleep(500)
  }
  throw lastError
}
