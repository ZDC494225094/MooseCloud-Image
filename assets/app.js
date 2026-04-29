const dataset = window.GPT_IMAGE_PROMPTS_DATA || {
  sourceRepo: "",
  syncedAt: "",
  totalCases: 0,
  categories: [],
  cases: []
};

const PLAYGROUND_STORAGE_KEY = "gpt-image-gallery-playground-v2";
const DEFAULT_IMAGES_MODEL = "gpt-image-2";
const DEFAULT_RESPONSES_MODEL = "gpt-5.5";

const DEFAULT_PLAYGROUND_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: DEFAULT_IMAGES_MODEL,
  timeout: 300,
  apiMode: "images",
  codexCli: false
};

const DEFAULT_PLAYGROUND_PARAMS = {
  size: "auto",
  quality: "auto",
  output_format: "png",
  output_compression: null,
  moderation: "auto",
  n: 1
};

const state = {
  activeCategory: "全部",
  query: "",
  sort: "newest",
  controlsCollapsed: false,
  controlsManualCollapsed: false,
  playground: createInitialPlaygroundState()
};

const controlsPanel = document.querySelector("#controls-panel");
const controlsCompactMeta = document.querySelector("#controls-compact-meta");
const controlsToggle = document.querySelector("#controls-toggle");
const statsElement = document.querySelector("#stats");
const metaElement = document.querySelector("#data-meta");
const chipsElement = document.querySelector("#category-chips");
const galleryElement = document.querySelector("#gallery");
const summaryElement = document.querySelector("#results-summary");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const modal = document.querySelector("#case-modal");
const modalContent = document.querySelector("#modal-content");
const modalClose = document.querySelector("#modal-close");

const playgroundRoot = document.querySelector("#playground");
const playgroundHint = document.querySelector("#playground-hint");
const playgroundSource = document.querySelector("#playground-source");
const playgroundStatus = document.querySelector("#playground-status");
const playgroundResults = document.querySelector("#playground-results");
const playgroundClearPrompt = document.querySelector("#playground-clear-prompt");
const playgroundClearSource = document.querySelector("#playground-clear-source");
const playgroundCopyPrompt = document.querySelector("#pg-copy-prompt");
const playgroundGenerate = document.querySelector("#pg-generate");
const playgroundClearHistory = document.querySelector("#pg-clear-history");

const playgroundFields = {
  baseUrl: document.querySelector("#pg-base-url"),
  apiKey: document.querySelector("#pg-api-key"),
  apiMode: document.querySelector("#pg-api-mode"),
  model: document.querySelector("#pg-model"),
  timeout: document.querySelector("#pg-timeout"),
  size: document.querySelector("#pg-size"),
  count: document.querySelector("#pg-count"),
  quality: document.querySelector("#pg-quality"),
  format: document.querySelector("#pg-format"),
  compression: document.querySelector("#pg-compression"),
  moderation: document.querySelector("#pg-moderation"),
  codexCli: document.querySelector("#pg-codex-cli"),
  prompt: document.querySelector("#pg-prompt")
};

let lastScrollY = window.scrollY;
let scrollTicking = false;

function createInitialPlaygroundState() {
  const stored = loadStoredPlayground();

  return {
    settings: {
      ...DEFAULT_PLAYGROUND_SETTINGS,
      ...(stored?.settings || {})
    },
    params: {
      ...DEFAULT_PLAYGROUND_PARAMS,
      ...(stored?.params || {})
    },
    prompt: stored?.prompt || "",
    sourceCaseId: stored?.sourceCaseId || null,
    sourceCaseTitle: stored?.sourceCaseTitle || "",
    jobs: []
  };
}

function loadStoredPlayground() {
  try {
    const raw = window.localStorage.getItem(PLAYGROUND_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function persistPlayground() {
  const payload = {
    settings: state.playground.settings,
    params: state.playground.params,
    prompt: state.playground.prompt,
    sourceCaseId: state.playground.sourceCaseId,
    sourceCaseTitle: state.playground.sourceCaseTitle
  };

  window.localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDuration(milliseconds) {
  if (!milliseconds || milliseconds < 0) {
    return "0s";
  }

  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);

  if (!minutes) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds % 60}s`;
}

function summarizePrompt(prompt, limit = 180) {
  if (!prompt) {
    return "该案例暂未提供提示词正文。";
  }

  const clean = String(prompt).replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function slugStatus(status) {
  if (status === "done") {
    return "完成";
  }

  if (status === "error") {
    return "失败";
  }

  return "生成中";
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/\/+$/, "");
}

function buildApiUrl(baseUrl, endpoint) {
  return `${normalizeBaseUrl(baseUrl)}/${String(endpoint).replace(/^\/+/, "")}`;
}

function getCategories() {
  return ["全部", ...dataset.categories];
}

function getSortLabel() {
  const labels = {
    newest: "最新",
    oldest: "最早",
    title: "标题 A-Z",
    promptLength: "长提示词"
  };

  return labels[state.sort] || "最新";
}

function getFilteredCases() {
  const query = state.query.trim().toLowerCase();

  const filtered = dataset.cases.filter((item) => {
    const matchesCategory =
      state.activeCategory === "全部" || item.category === state.activeCategory;
    const haystack = [item.title, item.authorHandle, item.category, item.prompt]
      .join(" ")
      .toLowerCase();
    const matchesQuery = !query || haystack.includes(query);

    return matchesCategory && matchesQuery;
  });

  switch (state.sort) {
    case "oldest":
      return filtered.sort((left, right) => left.caseNumber - right.caseNumber);
    case "title":
      return filtered.sort((left, right) => left.title.localeCompare(right.title));
    case "promptLength":
      return filtered.sort((left, right) => right.promptLength - left.promptLength);
    case "newest":
    default:
      return filtered.sort((left, right) => right.caseNumber - left.caseNumber);
  }
}

function renderStats() {
  const totalImages = dataset.cases.reduce((count, item) => count + item.images.length, 0);
  const totalPrompts = dataset.cases.filter((item) => item.prompt).length;
  const cards = [
    { label: "案例总数", value: dataset.totalCases },
    { label: "分类数量", value: dataset.categories.length },
    { label: "图片数量", value: totalImages },
    { label: "含提示词案例", value: totalPrompts }
  ];

  statsElement.innerHTML = cards
    .map(
      (item) => `
        <article class="stat-card">
          <strong>${item.value}</strong>
          <span>${item.label}</span>
        </article>
      `
    )
    .join("");
}

function renderMeta() {
  metaElement.textContent = `本地同步 ${dataset.totalCases} 个案例，最后同步时间 ${formatDate(
    dataset.syncedAt
  )}`;
}

function renderChips() {
  chipsElement.innerHTML = getCategories()
    .map((category) => {
      const isActive = category === state.activeCategory;
      return `
        <button
          class="chip${isActive ? " is-active" : ""}"
          type="button"
          data-category="${escapeHtml(category)}"
        >
          ${escapeHtml(category)}
        </button>
      `;
    })
    .join("");
}

function renderSummary(visibleCount) {
  summaryElement.textContent = `当前显示 ${visibleCount} / ${dataset.totalCases} 个案例`;
  const activeFilters = [
    state.activeCategory === "全部" ? "全部分类" : state.activeCategory,
    getSortLabel()
  ];

  if (state.query.trim()) {
    activeFilters.push(`搜索“${state.query.trim()}”`);
  }

  if (controlsCompactMeta) {
    controlsCompactMeta.textContent = `${visibleCount} 个案例 · ${activeFilters.join(" · ")}`;
  }
}

function syncControlsToggleLabel() {
  if (!controlsToggle) {
    return;
  }

  controlsToggle.textContent = state.controlsCollapsed ? "展开筛选" : "收起筛选";
  controlsToggle.setAttribute("aria-expanded", String(!state.controlsCollapsed));
}

function setControlsCollapsed(collapsed) {
  if (!controlsPanel) {
    return;
  }

  if (state.controlsCollapsed === collapsed) {
    return;
  }

  state.controlsCollapsed = collapsed;
  controlsPanel.classList.toggle("is-collapsed", collapsed);
  syncControlsToggleLabel();
}

function renderGallery() {
  const visibleCases = getFilteredCases();
  renderSummary(visibleCases.length);

  if (!visibleCases.length) {
    galleryElement.innerHTML = `
      <article class="empty-state panel">
        <h3>没有匹配结果</h3>
        <p>可以试试更短的关键词，或者切回“全部”分类。</p>
      </article>
    `;
    return;
  }

  galleryElement.innerHTML = visibleCases
    .map((item) => {
      const previewImage = item.images[0] || "";
      return `
        <article class="card panel" data-case-id="${item.id}">
          <button class="card__image-wrap" type="button" data-open-case="${item.id}">
            <img
              class="card__image"
              src="${previewImage}"
              alt="${escapeHtml(item.title)}"
              loading="lazy"
            >
          </button>
          <div class="card__body">
            <div class="card__meta">
              <span class="tag">${escapeHtml(item.category)}</span>
              <span class="case-no">Case ${item.caseNumber}</span>
            </div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="card__author">@${escapeHtml(item.authorHandle)}</p>
            <p class="card__summary">${escapeHtml(summarizePrompt(item.prompt))}</p>
            <div class="card__actions">
              <button class="text-button" type="button" data-use-case="${item.id}">
                带入创作台
              </button>
              <button class="text-button" type="button" data-open-case="${item.id}">
                查看详情
              </button>
              <a href="${item.tweetUrl}" target="_blank" rel="noreferrer">来源推文</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderModal(caseItem) {
  modalContent.innerHTML = `
    <div class="modal__header">
      <div>
        <p class="modal__eyebrow">${escapeHtml(caseItem.category)}</p>
        <h2>${escapeHtml(caseItem.title)}</h2>
        <p class="modal__subline">Case ${caseItem.caseNumber} · @${escapeHtml(
          caseItem.authorHandle
        )}</p>
      </div>
      <div class="modal__links">
        <a href="${caseItem.tweetUrl}" target="_blank" rel="noreferrer">打开推文</a>
        <a href="${caseItem.repoUrl}" target="_blank" rel="noreferrer">打开仓库</a>
        <button id="use-case-prompt" type="button">带入创作台</button>
        <button id="copy-prompt" type="button">复制提示词</button>
      </div>
    </div>
    <div class="modal__gallery">
      ${caseItem.images
        .map(
          (imageUrl, index) => `
            <figure class="modal__figure">
              <img src="${imageUrl}" alt="${escapeHtml(caseItem.title)} 第${index + 1}张图">
            </figure>
          `
        )
        .join("")}
    </div>
    <section class="prompt-block">
      <div class="prompt-block__header">
        <h3>Prompt</h3>
        <span>${caseItem.promptLength} 字符</span>
      </div>
      <pre><code>${escapeHtml(caseItem.prompt || "该案例暂未提供提示词正文。")}</code></pre>
    </section>
  `;

  const copyButton = document.querySelector("#copy-prompt");
  copyButton?.addEventListener("click", async () => {
    await copyText(caseItem.prompt || "", copyButton, "已复制");
  });

  const useButton = document.querySelector("#use-case-prompt");
  useButton?.addEventListener("click", () => {
    applyCaseToPlayground(caseItem.id);
    modal.close();
  });
}

function openCase(caseId) {
  const caseItem = dataset.cases.find((item) => item.id === caseId);

  if (!caseItem) {
    return;
  }

  renderModal(caseItem);
  modal.showModal();
}

function renderPlaygroundFields() {
  const { settings, params, prompt } = state.playground;

  playgroundFields.baseUrl.value = settings.baseUrl;
  playgroundFields.apiKey.value = settings.apiKey;
  playgroundFields.apiMode.value = settings.apiMode;
  playgroundFields.model.value = settings.model;
  playgroundFields.timeout.value = String(settings.timeout);
  playgroundFields.size.value = params.size;
  playgroundFields.count.value = String(params.n);
  playgroundFields.quality.value = params.quality;
  playgroundFields.format.value = params.output_format;
  playgroundFields.compression.value =
    params.output_compression == null ? "" : String(params.output_compression);
  playgroundFields.moderation.value = params.moderation;
  playgroundFields.codexCli.checked = settings.codexCli;
  playgroundFields.prompt.value = prompt;

  const compressionDisabled = params.output_format === "png";
  playgroundFields.compression.disabled = compressionDisabled;
  playgroundFields.compression.placeholder = compressionDisabled
    ? "PNG 不支持压缩率"
    : "0 - 100";

  const qualityDisabled = settings.codexCli;
  playgroundFields.quality.disabled = qualityDisabled;
}

function renderPlaygroundMeta() {
  const sourceCase = state.playground.sourceCaseId
    ? dataset.cases.find((item) => item.id === state.playground.sourceCaseId)
    : null;

  if (sourceCase) {
    playgroundHint.textContent = `当前已绑定 ${sourceCase.title}，你可以继续修改 Prompt 后再生成。`;
    playgroundSource.innerHTML = `
      来源案例：<strong>${escapeHtml(sourceCase.title)}</strong>
      <span>· ${escapeHtml(sourceCase.category)}</span>
      <span>· @${escapeHtml(sourceCase.authorHandle)}</span>
    `;
    return;
  }

  playgroundHint.textContent =
    "选择任意案例即可把提示词带入这里，然后直接调用 Images API 或 Responses API 生成图片。";
  playgroundSource.textContent = "当前未绑定案例，你也可以直接手写 Prompt。";
}

function renderPlaygroundJobs() {
  const jobs = state.playground.jobs;

  if (!jobs.length) {
    playgroundResults.innerHTML = `
      <article class="empty-state panel">
        <h3>还没有生成记录</h3>
        <p>从下方任意案例带入 Prompt，或者直接写一个新 Prompt 开始。</p>
      </article>
    `;
    return;
  }

  playgroundResults.innerHTML = jobs
    .map((job) => {
      const actualParamText = job.actualParams
        ? Object.entries(job.actualParams)
            .filter(([, value]) => value != null && value !== "")
            .map(([key, value]) => `${key}: ${value}`)
            .join(" · ")
        : "";

      return `
        <article class="job-card panel">
          <div class="job-card__topline">
            <div>
              <p class="job-card__status job-card__status--${job.status}">${slugStatus(job.status)}</p>
              <h4>${escapeHtml(job.sourceCaseTitle || "自定义 Prompt")}</h4>
              <p class="job-card__meta">
                ${escapeHtml(formatDate(job.createdAt))} · ${escapeHtml(job.settings.apiMode)} · ${escapeHtml(
        job.settings.model
      )} · ${escapeHtml(formatDuration(job.elapsedMs))}
              </p>
            </div>
            <div class="job-card__actions">
              <button class="text-button" type="button" data-job-reuse="${job.id}">再次使用</button>
              <button class="text-button" type="button" data-job-copy="${job.id}">复制 Prompt</button>
              <button class="text-button" type="button" data-job-delete="${job.id}">删除</button>
            </div>
          </div>
          <p class="job-card__prompt">${escapeHtml(summarizePrompt(job.prompt, 240))}</p>
          ${
            job.error
              ? `<p class="job-card__error">${escapeHtml(job.error)}</p>`
              : actualParamText
                ? `<p class="job-card__meta">实际参数 · ${escapeHtml(actualParamText)}</p>`
                : ""
          }
          ${
            job.revisedPrompts?.some(Boolean)
              ? `<details class="job-card__details">
                  <summary>查看 API 改写后的 Prompt</summary>
                  ${job.revisedPrompts
                    .filter(Boolean)
                    .map(
                      (text, index) =>
                        `<pre><code>${escapeHtml(`版本 ${index + 1}\n${text}`)}</code></pre>`
                    )
                    .join("")}
                </details>`
              : ""
          }
          ${
            job.images.length
              ? `<div class="job-card__images">
                  ${job.images
                    .map(
                      (imageUrl, index) => `
                        <figure class="job-card__figure">
                          <img src="${imageUrl}" alt="${escapeHtml(job.sourceCaseTitle || "生成结果")} ${index + 1}">
                        </figure>
                      `
                    )
                    .join("")}
                </div>`
              : `<div class="job-card__placeholder">等待生成结果…</div>`
          }
        </article>
      `;
    })
    .join("");
}

function setPlaygroundStatus(message, tone = "info") {
  playgroundStatus.textContent = message;
  playgroundStatus.dataset.tone = tone;
}

function setPlaygroundPrompt(prompt) {
  state.playground.prompt = prompt;
  playgroundFields.prompt.value = prompt;
  persistPlayground();
}

function applyCaseToPlayground(caseId) {
  const caseItem = dataset.cases.find((item) => item.id === caseId);

  if (!caseItem) {
    return;
  }

  state.playground.prompt = caseItem.prompt || "";
  state.playground.sourceCaseId = caseItem.id;
  state.playground.sourceCaseTitle = caseItem.title;
  renderPlaygroundFields();
  renderPlaygroundMeta();
  persistPlayground();
  setPlaygroundStatus(`已带入 ${caseItem.title}，可以直接生成或先改写 Prompt。`, "success");
  playgroundRoot.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearPlaygroundSource() {
  state.playground.sourceCaseId = null;
  state.playground.sourceCaseTitle = "";
  renderPlaygroundMeta();
  persistPlayground();
  setPlaygroundStatus("已解除案例绑定，当前 Prompt 保留不变。", "info");
}

function createJobSnapshot() {
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    status: "running",
    prompt: state.playground.prompt.trim(),
    sourceCaseId: state.playground.sourceCaseId,
    sourceCaseTitle: state.playground.sourceCaseTitle,
    settings: {
      ...state.playground.settings
    },
    params: {
      ...state.playground.params
    },
    actualParams: null,
    revisedPrompts: [],
    images: [],
    error: "",
    elapsedMs: 0
  };
}

function updateJob(jobId, patch) {
  state.playground.jobs = state.playground.jobs.map((job) =>
    job.id === jobId ? { ...job, ...patch } : job
  );
  renderPlaygroundJobs();
}

function deleteJob(jobId) {
  state.playground.jobs = state.playground.jobs.filter((job) => job.id !== jobId);
  renderPlaygroundJobs();
}

function resetPlaygroundHistory() {
  state.playground.jobs = [];
  renderPlaygroundJobs();
  setPlaygroundStatus("已清空当前会话中的生成历史。", "info");
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePlaygroundParams() {
  const params = state.playground.params;
  const normalized = {
    ...params,
    size: String(params.size || "auto").trim() || "auto",
    n: Math.max(1, Math.min(8, parseInteger(params.n, 1))),
    output_compression:
      params.output_format === "png"
        ? null
        : params.output_compression == null || params.output_compression === ""
          ? null
          : Math.max(0, Math.min(100, parseInteger(params.output_compression, 80)))
  };

  state.playground.params = normalized;
}

function normalizePlaygroundSettings() {
  const settings = state.playground.settings;
  state.playground.settings = {
    ...settings,
    baseUrl: normalizeBaseUrl(settings.baseUrl || DEFAULT_PLAYGROUND_SETTINGS.baseUrl),
    timeout: Math.max(10, Math.min(600, parseInteger(settings.timeout, 300))),
    model: String(settings.model || "").trim() || getDefaultModelByMode(settings.apiMode)
  };
}

function getDefaultModelByMode(apiMode) {
  return apiMode === "responses" ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL;
}

function createRequestHeaders(settings) {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    "Cache-Control": "no-store, no-cache, max-age=0",
    Pragma: "no-cache"
  };
}

async function readApiError(response) {
  try {
    const json = await response.json();
    return json?.error?.message || json?.message || `HTTP ${response.status}`;
  } catch (error) {
    try {
      return (await response.text()) || `HTTP ${response.status}`;
    } catch (innerError) {
      return `HTTP ${response.status}`;
    }
  }
}

function normalizeImageData(base64, outputFormat) {
  const mimeMap = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp"
  };
  const mimeType = mimeMap[outputFormat] || "image/png";
  return base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;
}

function pickActualParams(source) {
  if (!source || typeof source !== "object") {
    return {};
  }

  const actual = {};

  if (typeof source.size === "string") {
    actual.size = source.size;
  }

  if (["auto", "low", "medium", "high"].includes(source.quality)) {
    actual.quality = source.quality;
  }

  if (["png", "jpeg", "webp"].includes(source.output_format)) {
    actual.output_format = source.output_format;
  }

  if (typeof source.output_compression === "number") {
    actual.output_compression = source.output_compression;
  }

  if (["auto", "low"].includes(source.moderation)) {
    actual.moderation = source.moderation;
  }

  if (typeof source.n === "number") {
    actual.n = source.n;
  }

  return actual;
}

function mergeActualParams(...sources) {
  const merged = Object.assign(
    {},
    ...sources.filter((source) => source && Object.keys(source).length)
  );

  return Object.keys(merged).length ? merged : null;
}

function createResponsesTool(settings, params) {
  const tool = {
    type: "image_generation",
    action: "generate",
    size: params.size,
    output_format: params.output_format
  };

  if (!settings.codexCli) {
    tool.quality = params.quality;
  }

  if (params.output_format !== "png" && params.output_compression != null) {
    tool.output_compression = params.output_compression;
  }

  return tool;
}

function createResponsesInput(settings, prompt) {
  if (settings.codexCli) {
    return `Use the following text as the complete prompt. Do not rewrite it:\n${prompt}`;
  }

  return prompt;
}

async function callImageApi(options) {
  return options.settings.apiMode === "responses"
    ? callResponsesApi(options)
    : callImagesApi(options);
}

async function callImagesApi(options) {
  const { settings, prompt: originalPrompt, params } = options;
  const requests = settings.codexCli && params.n > 1 ? params.n : 1;

  if (requests > 1) {
    const results = await Promise.allSettled(
      Array.from({ length: requests }).map(() =>
        callImagesApiSingle({
          ...options,
          params: {
            ...params,
            n: 1,
            quality: "auto"
          }
        })
      )
    );

    return mergeConcurrentResults(results);
  }

  return callImagesApiSingle({
    ...options,
    prompt: originalPrompt
  });
}

async function callImagesApiSingle(options) {
  const { settings, prompt: originalPrompt, params } = options;
  const prompt = settings.codexCli
    ? `Use the following text as the complete prompt. Do not rewrite it:\n${originalPrompt}`
    : originalPrompt;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), settings.timeout * 1000);

  try {
    const body = {
      model: settings.model,
      prompt,
      size: params.size,
      output_format: params.output_format,
      moderation: params.moderation
    };

    if (!settings.codexCli) {
      body.quality = params.quality;
    }

    if (params.output_format !== "png" && params.output_compression != null) {
      body.output_compression = params.output_compression;
    }

    if (params.n > 1) {
      body.n = params.n;
    }

    const response = await fetch(buildApiUrl(settings.baseUrl, "images/generations"), {
      method: "POST",
      headers: {
        ...createRequestHeaders(settings),
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = await response.json();
    const data = Array.isArray(payload.data) ? payload.data : [];

    if (!data.length) {
      throw new Error("接口未返回图片数据");
    }

    const images = [];
    const revisedPrompts = [];

    data.forEach((item) => {
      if (item?.b64_json) {
        images.push(normalizeImageData(item.b64_json, params.output_format));
        revisedPrompts.push(item?.revised_prompt || "");
      } else if (item?.url) {
        images.push(item.url);
        revisedPrompts.push(item?.revised_prompt || "");
      }
    });

    if (!images.length) {
      throw new Error("接口未返回可用图片数据");
    }

    return {
      images,
      actualParams: mergeActualParams(pickActualParams(payload), { n: images.length }),
      revisedPrompts
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function callResponsesApi(options) {
  const requestCount = options.params.n > 1 ? options.params.n : 1;

  if (requestCount > 1) {
    const results = await Promise.allSettled(
      Array.from({ length: requestCount }).map(() =>
        callResponsesApiSingle({
          ...options,
          params: {
            ...options.params,
            n: 1
          }
        })
      )
    );

    return mergeConcurrentResults(results);
  }

  return callResponsesApiSingle(options);
}

function readResponseImageResult(item, outputFormat) {
  if (typeof item?.result === "string" && item.result.trim()) {
    return normalizeImageData(item.result, outputFormat);
  }

  if (item?.result?.b64_json) {
    return normalizeImageData(item.result.b64_json, outputFormat);
  }

  if (item?.result?.image) {
    return normalizeImageData(item.result.image, outputFormat);
  }

  if (item?.result?.data) {
    return normalizeImageData(item.result.data, outputFormat);
  }

  return "";
}

async function callResponsesApiSingle(options) {
  const { settings, prompt, params } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), settings.timeout * 1000);

  try {
    const body = {
      model: settings.model,
      input: createResponsesInput(settings, prompt),
      tools: [createResponsesTool(settings, params)],
      tool_choice: "required"
    };

    const response = await fetch(buildApiUrl(settings.baseUrl, "responses"), {
      method: "POST",
      headers: {
        ...createRequestHeaders(settings),
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = await response.json();
    const output = Array.isArray(payload.output) ? payload.output : [];
    const results = output
      .filter((item) => item?.type === "image_generation_call")
      .map((item) => ({
        image: readResponseImageResult(item, params.output_format),
        revisedPrompt: item?.revised_prompt || "",
        actualParams: mergeActualParams(
          pickActualParams(item),
          pickActualParams(payload?.tools?.[0])
        )
      }))
      .filter((item) => item.image);

    if (!results.length) {
      throw new Error("接口未返回可用图片数据");
    }

    return {
      images: results.map((item) => item.image),
      actualParams: mergeActualParams(results[0]?.actualParams, { n: results.length }),
      revisedPrompts: results.map((item) => item.revisedPrompt)
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function mergeConcurrentResults(results) {
  const successfulResults = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  if (!successfulResults.length) {
    const firstError = results.find((result) => result.status === "rejected");
    throw firstError?.reason || new Error("所有请求均失败");
  }

  const images = successfulResults.flatMap((result) => result.images);
  const revisedPrompts = successfulResults.flatMap((result) => result.revisedPrompts || []);
  const actualParams = mergeActualParams(successfulResults[0]?.actualParams, { n: images.length });

  return {
    images,
    revisedPrompts,
    actualParams
  };
}

async function handleGenerate() {
  normalizePlaygroundSettings();
  normalizePlaygroundParams();
  renderPlaygroundFields();
  persistPlayground();

  const { settings, params, prompt } = state.playground;

  if (!settings.apiKey.trim()) {
    setPlaygroundStatus("请先填写 API Key。", "error");
    return;
  }

  if (!prompt.trim()) {
    setPlaygroundStatus("请先输入 Prompt，或从下方案例带入。", "error");
    return;
  }

  const job = createJobSnapshot();
  state.playground.jobs = [job, ...state.playground.jobs].slice(0, 24);
  renderPlaygroundJobs();
  setPlaygroundStatus(`正在调用 ${settings.apiMode} 生成图片…`, "pending");

  try {
    const result = await callImageApi({
      settings,
      params,
      prompt: prompt.trim()
    });

    updateJob(job.id, {
      status: "done",
      images: result.images,
      revisedPrompts: result.revisedPrompts || [],
      actualParams: result.actualParams,
      elapsedMs: Date.now() - job.createdAt
    });
    setPlaygroundStatus(`生成完成，共返回 ${result.images.length} 张图片。`, "success");
  } catch (error) {
    updateJob(job.id, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - job.createdAt
    });
    setPlaygroundStatus(
      error instanceof Error ? `生成失败：${error.message}` : `生成失败：${String(error)}`,
      "error"
    );
  }
}

async function copyText(value, button, successText = "已复制") {
  const originalText = button?.textContent;

  try {
    await navigator.clipboard.writeText(value || "");

    if (button) {
      button.textContent = successText;
      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1200);
    }
  } catch (error) {
    if (button) {
      button.textContent = "复制失败";
      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1200);
    }
  }
}

function bindGalleryEvents() {
  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderGallery();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGallery();
  });

  chipsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (!button) {
      return;
    }

    state.activeCategory = button.dataset.category;
    renderChips();
    renderGallery();
  });

  galleryElement.addEventListener("click", (event) => {
    const useTrigger = event.target.closest("[data-use-case]");
    if (useTrigger) {
      applyCaseToPlayground(useTrigger.dataset.useCase);
      return;
    }

    const openTrigger = event.target.closest("[data-open-case]");
    if (openTrigger) {
      openCase(openTrigger.dataset.openCase);
    }
  });

  modalClose.addEventListener("click", () => {
    modal.close();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.close();
    }
  });
}

function bindPlaygroundEvents() {
  playgroundFields.baseUrl.addEventListener("input", (event) => {
    state.playground.settings.baseUrl = event.target.value;
    persistPlayground();
  });

  playgroundFields.apiKey.addEventListener("input", (event) => {
    state.playground.settings.apiKey = event.target.value;
    persistPlayground();
  });

  playgroundFields.apiMode.addEventListener("change", (event) => {
    const previousDefault = getDefaultModelByMode(state.playground.settings.apiMode);
    state.playground.settings.apiMode = event.target.value;

    if (
      !state.playground.settings.model ||
      state.playground.settings.model === previousDefault
    ) {
      state.playground.settings.model = getDefaultModelByMode(event.target.value);
    }

    renderPlaygroundFields();
    persistPlayground();
  });

  playgroundFields.model.addEventListener("input", (event) => {
    state.playground.settings.model = event.target.value;
    persistPlayground();
  });

  playgroundFields.timeout.addEventListener("input", (event) => {
    state.playground.settings.timeout = parseInteger(event.target.value, 300);
    persistPlayground();
  });

  playgroundFields.size.addEventListener("input", (event) => {
    state.playground.params.size = event.target.value;
    persistPlayground();
  });

  playgroundFields.count.addEventListener("input", (event) => {
    state.playground.params.n = parseInteger(event.target.value, 1);
    persistPlayground();
  });

  playgroundFields.quality.addEventListener("change", (event) => {
    state.playground.params.quality = event.target.value;
    persistPlayground();
  });

  playgroundFields.format.addEventListener("change", (event) => {
    state.playground.params.output_format = event.target.value;

    if (event.target.value === "png") {
      state.playground.params.output_compression = null;
    }

    renderPlaygroundFields();
    persistPlayground();
  });

  playgroundFields.compression.addEventListener("input", (event) => {
    const nextValue = event.target.value.trim();
    state.playground.params.output_compression = nextValue === "" ? null : parseInteger(nextValue, 80);
    persistPlayground();
  });

  playgroundFields.moderation.addEventListener("change", (event) => {
    state.playground.params.moderation = event.target.value;
    persistPlayground();
  });

  playgroundFields.codexCli.addEventListener("change", (event) => {
    state.playground.settings.codexCli = event.target.checked;

    if (state.playground.settings.codexCli) {
      state.playground.params.quality = "auto";
    }

    renderPlaygroundFields();
    persistPlayground();
  });

  playgroundFields.prompt.addEventListener("input", (event) => {
    state.playground.prompt = event.target.value;
    persistPlayground();
  });

  playgroundClearPrompt.addEventListener("click", () => {
    setPlaygroundPrompt("");
    setPlaygroundStatus("Prompt 已清空。", "info");
  });

  playgroundClearSource.addEventListener("click", () => {
    clearPlaygroundSource();
  });

  playgroundCopyPrompt.addEventListener("click", async () => {
    await copyText(state.playground.prompt, playgroundCopyPrompt, "Prompt 已复制");
  });

  playgroundGenerate.addEventListener("click", () => {
    handleGenerate();
  });

  playgroundClearHistory.addEventListener("click", () => {
    resetPlaygroundHistory();
  });

  playgroundResults.addEventListener("click", async (event) => {
    const reuseTrigger = event.target.closest("[data-job-reuse]");
    if (reuseTrigger) {
      const job = state.playground.jobs.find((item) => item.id === reuseTrigger.dataset.jobReuse);
      if (!job) {
        return;
      }

      state.playground.prompt = job.prompt;
      state.playground.sourceCaseId = job.sourceCaseId;
      state.playground.sourceCaseTitle = job.sourceCaseTitle;
      state.playground.settings = { ...state.playground.settings, ...job.settings };
      state.playground.params = { ...state.playground.params, ...job.params };
      renderPlaygroundFields();
      renderPlaygroundMeta();
      persistPlayground();
      playgroundRoot.scrollIntoView({ behavior: "smooth", block: "start" });
      setPlaygroundStatus("已将这次生成的配置回填到创作台。", "success");
      return;
    }

    const deleteTrigger = event.target.closest("[data-job-delete]");
    if (deleteTrigger) {
      deleteJob(deleteTrigger.dataset.jobDelete);
      return;
    }

    const copyTrigger = event.target.closest("[data-job-copy]");
    if (copyTrigger) {
      const job = state.playground.jobs.find((item) => item.id === copyTrigger.dataset.jobCopy);
      if (!job) {
        return;
      }

      await copyText(job.prompt, copyTrigger, "Prompt 已复制");
    }
  });
}

function bindControlsCollapse() {
  if (!controlsPanel) {
    return;
  }

  const mobileMedia = window.matchMedia("(max-width: 900px)");

  const handleMediaChange = () => {
    if (mobileMedia.matches) {
      state.controlsManualCollapsed = false;
      setControlsCollapsed(false);
    }
  };

  if (typeof mobileMedia.addEventListener === "function") {
    mobileMedia.addEventListener("change", handleMediaChange);
  } else if (typeof mobileMedia.addListener === "function") {
    mobileMedia.addListener(handleMediaChange);
  }

  controlsToggle?.addEventListener("click", () => {
    if (state.controlsCollapsed) {
      state.controlsManualCollapsed = false;
      setControlsCollapsed(false);
      return;
    }

    state.controlsManualCollapsed = true;
    setControlsCollapsed(true);
  });

  controlsPanel.addEventListener("mouseenter", () => {
    if (state.controlsCollapsed && !state.controlsManualCollapsed) {
      setControlsCollapsed(false);
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!scrollTicking) {
        window.requestAnimationFrame(updateControlsCollapseByScroll);
        scrollTicking = true;
      }
    },
    { passive: true }
  );

  updateControlsCollapseByScroll();
}

function updateControlsCollapseByScroll() {
  if (!controlsPanel) {
    return;
  }

  const mobileMedia = window.matchMedia("(max-width: 900px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const currentScrollY = window.scrollY;
  const delta = currentScrollY - lastScrollY;
  const passedThreshold = currentScrollY > 280;

  if (state.controlsManualCollapsed) {
    setControlsCollapsed(true);
    lastScrollY = currentScrollY;
    scrollTicking = false;
    return;
  }

  if (mobileMedia.matches || reduceMotion.matches || modal.open) {
    setControlsCollapsed(false);
    lastScrollY = currentScrollY;
    scrollTicking = false;
    return;
  }

  if (passedThreshold && delta > 10) {
    setControlsCollapsed(true);
  } else if (currentScrollY < 220 || delta < -10) {
    setControlsCollapsed(false);
  }

  lastScrollY = currentScrollY;
  scrollTicking = false;
}

function init() {
  normalizePlaygroundSettings();
  normalizePlaygroundParams();
  renderStats();
  renderMeta();
  renderChips();
  renderGallery();
  renderPlaygroundFields();
  renderPlaygroundMeta();
  renderPlaygroundJobs();
  setPlaygroundStatus("尚未开始生成。生成结果会显示在下方历史区。", "info");
  syncControlsToggleLabel();
  bindGalleryEvents();
  bindPlaygroundEvents();
  bindControlsCollapse();
}

init();
