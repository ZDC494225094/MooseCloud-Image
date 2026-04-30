import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const GITHUB_README_URL =
  'https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-prompts/main/README.md'
const GITHUB_REPO_URL = 'https://github.com/EvoLinkAI/awesome-gpt-image-2-prompts'
const GITHUB_RAW_BASE_URL =
  'https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-prompts/main/'
const GITHUB_IMAGE_BASE_URL =
  'https://cdn.jsdelivr.net/gh/EvoLinkAI/awesome-gpt-image-2-prompts@main/'

const OPENNANA_SITE_URL = 'https://opennana.com/awesome-prompt-gallery?media_type=image'
const OPENNANA_API_BASE_URL = 'https://api.opennana.com/api'
const OPENNANA_PAGE_SIZE = 100
const OPENNANA_MAX_ITEMS = readPositiveIntEnv('OPENNANA_MAX_ITEMS', Number.POSITIVE_INFINITY)
const OPENNANA_DETAIL_ITEMS = readPositiveIntEnv('OPENNANA_DETAIL_ITEMS', 200)
const OPENNANA_CONCURRENCY = readPositiveIntEnv('OPENNANA_CONCURRENCY', 8)

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const dataDir = path.join(projectRoot, 'public', 'data')
const outputFile = path.join(dataDir, 'cases.json')

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function readPositiveIntEnv(name, fallbackValue) {
  const rawValue = process.env[name]
  if (!rawValue) return fallbackValue

  if (rawValue.toLowerCase() === 'all') {
    return Number.POSITIVE_INFINITY
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue
}

function buildGithubImageUrl(relativePath) {
  return `${GITHUB_IMAGE_BASE_URL}${relativePath.replace(/^\.\//, '')}`
}

function buildGithubRawUrl(relativePath) {
  return `${GITHUB_RAW_BASE_URL}${relativePath.replace(/^\.\//, '')}`
}

function toSafeId(value, fallback = 'item') {
  const normalized = normalizeUrl(value)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

function normalizeUrl(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePromptVariants(prompts) {
  if (!Array.isArray(prompts)) return []

  return prompts
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null

      const text = normalizeUrl(entry.text)
      if (!text) return null

      return {
        type: normalizeUrl(entry.type) || 'default',
        label: normalizeUrl(entry.label) || 'Prompt',
        text,
      }
    })
    .filter(Boolean)
}

function pickPrimaryPrompt(promptVariants) {
  if (!Array.isArray(promptVariants) || promptVariants.length === 0) return ''

  const englishPrompt = promptVariants.find((entry) => entry.type === 'en' && entry.text)
  return (englishPrompt || promptVariants[0]).text || ''
}

function parseGithubCases(markdown) {
  const categoryMatches = [...markdown.matchAll(/^#{1,3}\s+(.+?Cases)(?:\s+>|$)/gm)].map(
    (match) => ({
      index: match.index ?? 0,
      category: match[1].trim(),
    }),
  )
  const caseHeadingMatches = [
    ...markdown.matchAll(
      /^###\s+Case\s+(\d+):\s+\[(.+?)\]\((https?:\/\/[^\s)]+)\)\s+\(by\s+\[@([^\]]+)\]\((https?:\/\/[^\s)]+)\)\)\s*$/gm,
    ),
  ]

  const cases = caseHeadingMatches.map((caseHeadingMatch, index) => {
    const caseNumber = Number(caseHeadingMatch[1])
    const title = caseHeadingMatch[2].trim()
    const tweetUrl = caseHeadingMatch[3]
    const authorHandle = caseHeadingMatch[4]
    const authorUrl = caseHeadingMatch[5]
    const blockStart = (caseHeadingMatch.index ?? 0) + caseHeadingMatch[0].length
    const blockEnd =
      index < caseHeadingMatches.length - 1
        ? (caseHeadingMatches[index + 1].index ?? markdown.length)
        : markdown.length
    const block = markdown.slice(blockStart, blockEnd)
    const category =
      [...categoryMatches].reverse().find((entry) => entry.index < (caseHeadingMatch.index ?? 0))
        ?.category || ''
    const imageMatches = [...block.matchAll(/<img\s+[^>]*src="\.\/([^"]+)"/g)]
    const imagePaths = unique(imageMatches.map((match) => match[1].trim()))
    const images = imagePaths.map(buildGithubImageUrl)
    const promptMatch = block.match(/\*\*Prompt:\*\*\s*```([\s\S]*?)```/)
    const prompt = promptMatch ? promptMatch[1].trim() : ''
    const promptVariants = prompt
      ? [
          {
            type: 'default',
            label: 'Prompt',
            text: prompt,
          },
        ]
      : []
    const stableId = `github-${toSafeId(tweetUrl, `case-${caseNumber}`)}`

    return {
      id: stableId,
      title,
      category,
      sourceType: 'github',
      sourceLabel: 'Awesome GPT Image 2 Prompts',
      sourceItemUrl: tweetUrl,
      externalSourceUrl: tweetUrl,
      sourceName: `@${authorHandle}`,
      authorHandle,
      authorUrl,
      model: '',
      tags: [],
      imagePaths,
      coverImage: images[0] || '',
      images,
      prompt,
      prompts: promptVariants,
      promptLength: prompt.length,
      caseNumber,
      sortValue: caseNumber,
      createdAt: '',
      updatedAt: '',
    }
  })

  return cases.sort((left, right) => right.caseNumber - left.caseNumber)
}

function extractGithubCaseFilePaths(readmeMarkdown) {
  return unique(
    [...readmeMarkdown.matchAll(/\((cases\/[a-z0-9-]+\.md)\)/gi)].map((match) => match[1].trim()),
  )
}

async function fetchGithubCases() {
  const readmeMarkdown = await download(GITHUB_README_URL)
  const caseFilePaths = extractGithubCaseFilePaths(readmeMarkdown)
  const allCases = new Map()

  for (const item of parseGithubCases(readmeMarkdown)) {
    allCases.set(item.sourceItemUrl || item.id, item)
  }

  if (caseFilePaths.length > 0) {
    console.log(`Fetching ${caseFilePaths.length} GitHub case files...`)

    const caseFileResults = await mapWithConcurrency(caseFilePaths, 4, async (relativePath) => ({
      relativePath,
      markdown: await download(buildGithubRawUrl(relativePath)),
    }))

    caseFileResults.forEach(({ relativePath, markdown }) => {
      const parsedCases = parseGithubCases(markdown)
      console.log(`Parsed ${parsedCases.length} GitHub cases from ${relativePath}`)

      parsedCases.forEach((item) => {
        allCases.set(item.sourceItemUrl || item.id, item)
      })
    })
  }

  return [...allCases.values()].sort((left, right) => right.caseNumber - left.caseNumber)
}

async function download(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'moosecloud-gallery-sync/1.0',
        Accept: 'application/json,text/plain,*/*',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    return new TextDecoder('utf-8').decode(bytes)
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }

    const tempDir = path.join(projectRoot, '.tmp-sync-downloads')
    await mkdir(tempDir, { recursive: true })

    const tempFile = path.join(
      tempDir,
      `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    )
    const escapedUrl = url.replace(/'/g, "''")
    const escapedTempFile = tempFile.replace(/'/g, "''")
    const command =
      "$ProgressPreference='SilentlyContinue';" +
      ` Invoke-WebRequest -UseBasicParsing '${escapedUrl}' -OutFile '${escapedTempFile}'`

    try {
      await execFileAsync(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoProfile', '-Command', command],
        {
          encoding: 'utf8',
          maxBuffer: 50 * 1024 * 1024,
        },
      )

      const bytes = await readFile(tempFile)
      return new TextDecoder('utf-8').decode(bytes)
    } finally {
      await unlink(tempFile).catch(() => {})
    }
  }
}

async function requestJson(url) {
  const content = await download(url)
  return JSON.parse(content)
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

async function fetchOpenNanaListPage(page) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(OPENNANA_PAGE_SIZE),
    sort: 'reviewed_at',
    order: 'DESC',
    media_type: 'image',
  })

  const payload = await requestJson(`${OPENNANA_API_BASE_URL}/prompts?${params.toString()}`)
  if (payload?.status !== 200 || !payload?.data) {
    throw new Error(`OpenNana list API returned invalid payload for page ${page}`)
  }

  return payload.data
}

async function fetchOpenNanaListItems() {
  if (OPENNANA_MAX_ITEMS <= 0) return []

  const items = []
  let page = 1
  let hasMore = true

  while (hasMore && items.length < OPENNANA_MAX_ITEMS) {
    const data = await fetchOpenNanaListPage(page)
    const pageItems = Array.isArray(data.items) ? data.items : []

    const normalizedItems = pageItems.filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        !entry._is_sponsor &&
        normalizeUrl(entry.slug) &&
        normalizeUrl(entry.cover_image),
    )

    items.push(...normalizedItems)
    hasMore = Boolean(data.pagination?.has_more)
    page += 1
  }

  return unique(items.map((entry) => entry.slug))
    .slice(0, Number.isFinite(OPENNANA_MAX_ITEMS) ? OPENNANA_MAX_ITEMS : undefined)
    .map((slug) => items.find((entry) => entry.slug === slug))
    .filter(Boolean)
}

async function fetchOpenNanaDetail(slug) {
  const payload = await requestJson(`${OPENNANA_API_BASE_URL}/prompts/${encodeURIComponent(slug)}`)
  if (payload?.status !== 200 || !payload?.data) {
    throw new Error(`OpenNana detail API returned invalid payload for ${slug}`)
  }

  return payload.data
}

function normalizeOpenNanaCase(listItem, detail) {
  const slug = normalizeUrl(detail.slug) || normalizeUrl(listItem.slug)
  const promptVariants = normalizePromptVariants(detail.prompts)
  const prompt = pickPrimaryPrompt(promptVariants)
  const sourceName = normalizeUrl(detail.source_name) || 'OpenNana'
  const authorHandle = sourceName.replace(/^@/, '')
  const reviewedAt = normalizeUrl(detail.reviewed_at)
  const updatedAt = normalizeUrl(detail.updated_at)
  const createdAt = normalizeUrl(detail.created_at)
  const sortValue =
    Date.parse(reviewedAt || updatedAt || createdAt) ||
    Date.parse(updatedAt || createdAt) ||
    Number(detail.id) ||
    0
  const images = Array.isArray(detail.images)
    ? detail.images.map(normalizeUrl).filter(Boolean)
    : []
  const tags = Array.isArray(detail.tags) ? detail.tags.map(normalizeUrl).filter(Boolean) : []
  const sourceItemUrl = `https://opennana.com/awesome-prompt-gallery/${slug}`
  const category = normalizeUrl(detail.model) || 'OpenNana'

  return {
    id: `opennana-${toSafeId(slug, String(detail.id || listItem.id || 'item'))}`,
    slug,
    title: normalizeUrl(detail.title) || normalizeUrl(listItem.title) || slug,
    category,
    sourceType: 'opennana',
    sourceLabel: 'OpenNana',
    sourceItemUrl,
    externalSourceUrl: normalizeUrl(detail.source_url),
    sourceName,
    authorHandle,
    authorUrl: normalizeUrl(detail.source_url),
    model: normalizeUrl(detail.model),
    tags,
    imagePaths: [],
    coverImage: normalizeUrl(listItem.cover_image) || images[0] || '',
    images,
    prompt,
    prompts: promptVariants,
    promptLength: prompt.length,
    caseNumber: null,
    sortValue,
    createdAt,
    updatedAt: updatedAt || reviewedAt,
  }
}

function normalizeOpenNanaListCase(listItem) {
  const slug = normalizeUrl(listItem.slug)
  const coverImage = normalizeUrl(listItem.cover_image)
  const numericId = Number(listItem.id) || 0

  return {
    id: `opennana-${toSafeId(slug, String(numericId || 'item'))}`,
    slug,
    title: normalizeUrl(listItem.title) || slug || 'OpenNana',
    category: 'OpenNana',
    sourceType: 'opennana',
    sourceLabel: 'OpenNana',
    sourceItemUrl: `https://opennana.com/awesome-prompt-gallery/${slug}`,
    externalSourceUrl: '',
    sourceName: 'OpenNana',
    authorHandle: '',
    authorUrl: '',
    model: '',
    tags: [],
    imagePaths: [],
    coverImage,
    images: coverImage ? [coverImage] : [],
    prompt: '',
    prompts: [],
    promptLength: 0,
    caseNumber: null,
    sortValue: numericId,
    createdAt: '',
    updatedAt: '',
  }
}

async function fetchOpenNanaCases() {
  const listItems = await fetchOpenNanaListItems()
  if (listItems.length === 0) return []

  const detailTargetCount = Number.isFinite(OPENNANA_DETAIL_ITEMS)
    ? Math.min(OPENNANA_DETAIL_ITEMS, listItems.length)
    : listItems.length
  const detailedItems = listItems.slice(0, detailTargetCount)
  const detailMap = new Map()

  if (detailedItems.length > 0) {
    console.log(`Fetching ${detailedItems.length} OpenNana prompt details...`)

    const detailedCases = await mapWithConcurrency(
      detailedItems,
      OPENNANA_CONCURRENCY,
      async (item, index) => {
        const slug = normalizeUrl(item.slug)
        const detail = await fetchOpenNanaDetail(slug)

        if ((index + 1) % 20 === 0 || index === detailedItems.length - 1) {
          console.log(`Fetched OpenNana details: ${index + 1}/${detailedItems.length}`)
        }

        return normalizeOpenNanaCase(item, detail)
      },
    )

    detailedCases.forEach((item) => {
      detailMap.set(item.slug, item)
    })
  }

  return listItems
    .map((item) => detailMap.get(normalizeUrl(item.slug)) || normalizeOpenNanaListCase(item))
    .filter(Boolean)
    .sort((left, right) => right.sortValue - left.sortValue)
}

async function main() {
  const githubCases = await fetchGithubCases()
  const opennanaCases = await fetchOpenNanaCases()
  const cases = [...opennanaCases, ...githubCases].sort((left, right) => right.sortValue - left.sortValue)
  const categories = unique(cases.map((item) => item.category)).sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  )

  const payload = {
    sourceRepo: GITHUB_REPO_URL,
    sourceReadme: GITHUB_README_URL,
    syncedAt: new Date().toISOString(),
    totalCases: cases.length,
    categories,
    sources: [
      {
        id: 'github-awesome-gpt-image-2-prompts',
        label: 'Awesome GPT Image 2 Prompts',
        type: 'github',
        url: GITHUB_REPO_URL,
      },
      {
        id: 'opennana',
        label: 'OpenNana',
        type: 'opennana',
        url: OPENNANA_SITE_URL,
      },
    ],
    cases,
  }

  await mkdir(dataDir, { recursive: true })
  await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`Synced ${githubCases.length} GitHub cases + ${opennanaCases.length} OpenNana cases`)
  console.log(`Wrote ${cases.length} total cases to ${outputFile}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
