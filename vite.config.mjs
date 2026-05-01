import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { handleStorageSaveRequest, tryServeStoredImageRequest } from './storageProxy.mjs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const DEFAULT_PROXY_PREFIX = '/api-proxy'

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

function normalizeDevProxyConfig(input) {
  if (!input || typeof input !== 'object') return null

  const record = input
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix =
    typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')),
    )
  } catch (error) {
    const err = error
    if (err.code === 'ENOENT') return null
    throw error
  }
}

function storageProxyPlugin() {
  return {
    name: 'local-storage-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const requestUrl = request.url || '/'

          if (request.method === 'POST' && requestUrl.split('?')[0] === '/api/storage/save') {
            await handleStorageSaveRequest(request, response)
            return
          }

          if (await tryServeStoredImageRequest(requestUrl, response)) {
            return
          }

          next()
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [storageProxyPlugin(), react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    build: {
      rollupOptions: {
        input: {
          gallery: resolve(process.cwd(), 'index.html'),
          playground: resolve(process.cwd(), 'playground.html'),
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: false,
      proxy:
        devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : undefined,
    },
  }
})
