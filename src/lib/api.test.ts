import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, DEFAULT_SETTINGS } from '../types'
import { callImageApi } from './api'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

describe('callImageApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('parses Responses API image results from string and object result shapes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      output: [
        {
          type: 'image_generation_call',
          result: 'aW1hZ2Ux',
          revised_prompt: 'first',
          size: '1024x1024',
        },
        {
          type: 'image_generation_call',
          result: { b64_json: 'aW1hZ2Uy' },
          revised_prompt: 'second',
        },
        {
          type: 'image_generation_call',
          result: { image: 'data:image/png;base64,aW1hZ2Uz' },
          revised_prompt: 'third',
        },
        {
          type: 'image_generation_call',
          result: { data: 'aW1hZ2U0' },
          revised_prompt: 'fourth',
        },
      ],
      tools: [{
        type: 'image_generation',
        output_format: 'png',
        quality: 'high',
      }],
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ux',
      'data:image/png;base64,aW1hZ2Uy',
      'data:image/png;base64,aW1hZ2Uz',
      'data:image/png;base64,aW1hZ2U0',
    ])
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'high',
      size: '1024x1024',
    })
    expect(result.actualParamsList).toEqual([
      { output_format: 'png', quality: 'high', size: '1024x1024' },
      { output_format: 'png', quality: 'high' },
      { output_format: 'png', quality: 'high' },
      { output_format: 'png', quality: 'high' },
    ])
    expect(result.revisedPrompts).toEqual(['first', 'second', 'third', 'fourth'])
  })

  it('preserves result image URLs instead of downloading them into base64', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url.includes('/images/generations')) {
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
          setTimeout(() => {
            resolve(jsonResponse({
              data: [{ url: 'https://cdn.example.com/image.png' }],
            }))
          }, 900)
        })
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const resultPromise = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.images).toEqual(['https://cdn.example.com/image.png'])
  })

  it('aggregates concurrent Responses API calls for multi-image requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2Ux',
          revised_prompt: 'first',
          size: '1024x1024',
        }],
        tools: [{
          type: 'image_generation',
          output_format: 'png',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        output: [{
          type: 'image_generation_call',
          result: { data: 'aW1hZ2Uy' },
          revised_prompt: 'second',
          size: '1536x1024',
        }],
        tools: [{
          type: 'image_generation',
          output_format: 'png',
        }],
      }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ux',
      'data:image/png;base64,aW1hZ2Uy',
    ])
    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1024x1024',
      n: 2,
    })
    expect(result.actualParamsList).toEqual([
      { output_format: 'png', size: '1024x1024' },
      { output_format: 'png', size: '1536x1024' },
    ])
    expect(result.revisedPrompts).toEqual(['first', 'second'])
  })
})
