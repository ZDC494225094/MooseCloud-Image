import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord, StoredImage } from './types'
import { DEFAULT_PARAMS } from './types'

const { callImageApiMock } = vi.hoisted(() => ({
  callImageApiMock: vi.fn(),
}))

let mockTasks: TaskRecord[] = []
let mockImages: StoredImage[] = []
let storedImageCounter = 0

vi.mock('./lib/api', () => ({
  callImageApi: callImageApiMock,
}))

vi.mock('./lib/db', () => ({
  getAllTasks: vi.fn(async () => mockTasks),
  putTask: vi.fn(async () => 'ok'),
  deleteTask: vi.fn(async () => undefined),
  clearTasks: vi.fn(async () => undefined),
  getImage: vi.fn(async (id: string) => mockImages.find((image) => image.id === id)),
  getAllImages: vi.fn(async () => mockImages),
  putImage: vi.fn(async () => 'ok'),
  deleteImage: vi.fn(async () => undefined),
  clearImages: vi.fn(async () => undefined),
  storeImage: vi.fn(async () => `stored-image-${++storedImageCounter}`),
  hashDataUrl: vi.fn(async () => 'hash'),
}))

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS, n: 2 },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'running',
    executionState: 'processing',
    requestedCount: 2,
    completedCount: 0,
    failedCount: 0,
    error: null,
    createdAt: 1,
    startedAt: 2,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

describe('initStore resume behavior', () => {
  beforeEach(() => {
    mockTasks = []
    mockImages = []
    storedImageCounter = 0
    callImageApiMock.mockReset()
    callImageApiMock.mockImplementation(() => new Promise(() => undefined))
    vi.resetModules()
  })

  it('marks running tasks as interrupted on cold start', async () => {
    mockTasks = [makeTask()]
    const { TASK_INTERRUPTED_MESSAGE, initStore, useStore } = await import('./store')

    await initStore()

    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('error')
    expect(task.error).toBe(TASK_INTERRUPTED_MESSAGE)
    expect(task.executionState).toBeUndefined()
  })

  it('requeues running tasks after same-tab refresh resume', async () => {
    mockTasks = [makeTask()]
    const { initStore, useStore } = await import('./store')

    await initStore({ resumeActiveTasks: true })

    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('running')
    expect(['queued', 'processing']).toContain(task.executionState)
    expect(task.error).toBeNull()
  })

  it('starts multiple resumed tasks independently without waiting for each other', async () => {
    mockTasks = [
      makeTask({ id: 'task-a', params: { ...DEFAULT_PARAMS, n: 1 }, requestedCount: 1 }),
      makeTask({ id: 'task-b', params: { ...DEFAULT_PARAMS, n: 1 }, requestedCount: 1 }),
    ]
    const { initStore, useStore } = await import('./store')

    await initStore({ resumeActiveTasks: true })
    await vi.waitFor(() => {
      expect(callImageApiMock).toHaveBeenCalledTimes(2)
    })

    const tasks = useStore.getState().tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.every((task) => task.status === 'running')).toBe(true)
    expect(tasks.every((task) => task.executionState === 'processing')).toBe(true)
  })

  it('keeps finished outputs and only resumes remaining work', async () => {
    mockTasks = [
      makeTask({
        outputImages: ['img-1'],
        completedCount: 1,
      }),
    ]
    callImageApiMock.mockResolvedValueOnce({
      images: ['data:image/png;base64,bbbb'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [undefined],
    })
    const { initStore, useStore } = await import('./store')

    await initStore({ resumeActiveTasks: true })
    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0]?.status).toBe('done')
    })

    const task = useStore.getState().tasks[0]
    expect(callImageApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ n: 1 }),
      }),
    )
    expect(task.outputImages).toHaveLength(2)
    expect(task.outputImages[0]).toBe('img-1')
    expect(task.completedCount).toBe(2)
    expect(task.requestedCount).toBe(2)
    expect(task.failedCount).toBe(0)
    expect(task.error).toBeNull()
  })

  it('normalizes already-complete running tasks to done during resume', async () => {
    mockTasks = [
      makeTask({
        outputImages: ['img-1', 'img-2'],
        completedCount: 2,
      }),
    ]
    const { initStore, useStore } = await import('./store')

    await initStore({ resumeActiveTasks: true })

    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('done')
    expect(task.executionState).toBeUndefined()
    expect(task.error).toBeNull()
  })
})
