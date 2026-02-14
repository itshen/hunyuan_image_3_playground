/**
 * HunyuanImage API 测试工具 - 前端逻辑
 * 支持多任务并行
 */

// ============ 快速选择配置 ============
// PROMPT_GROUPS 已移至 prompts_data.js

// ============ 状态 ============

const state = {
    history: [],
    ratio: '1:1',      // 比例
    resolution: 1280,  // 最长边
    count: 1,
    parallel: false,   // 是否并发，默认顺序
    refImages: [],
    serverPrice: 0,
    activeTasks: {},   // {taskId: {prompt, count, startedTs, status}}
    compactView: false, // 紧凑视图
};

// 根据比例和分辨率计算宽高
function calcDimensions() {
    if (state.ratio === 'auto') {
        return { width: 1024, height: 1024, isAuto: true };
    }
    const [rw, rh] = state.ratio.split(':').map(Number);
    const res = state.resolution;
    
    if (rw >= rh) {
        // 横向或正方形，宽度为长边
        return { width: res, height: Math.round(res * rh / rw), isAuto: false };
    } else {
        // 竖向，高度为长边
        return { width: Math.round(res * rw / rh), height: res, isAuto: false };
    }
}

// 获取 image_size 参数
// auto: 服务端根据 width/height 决定
// custom: 自定义分辨率，用 width/height 指定
function getImageSizeParam() {
    if (state.ratio === 'auto') {
        return 'auto';
    }
    return 'custom';
}

// 更新分辨率预览和最长边显示
function updateResolutionPreview() {
    const preview = $('#resolution-preview');
    const resRow = $('#resolution-row');
    
    if (state.ratio === 'auto') {
        if (preview) preview.textContent = 'auto';
        if (resRow) resRow.style.display = 'none';
    } else {
        const dim = calcDimensions();
        if (preview) preview.textContent = `${dim.width} x ${dim.height}`;
        if (resRow) resRow.style.display = '';
    }
}

// ============ DOM ============

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    apiUrl: $('#api-url'),
    prompt: $('#prompt'),
    seed: $('#seed'),
    steps: $('#steps'),
    serverPrice: $('#server-price'),
    generateBtn: $('#generate-btn'),
    gallery: $('#gallery'),
    emptyState: $('#empty-state'),
    imageCount: $('#image-count'),
    clearAllBtn: $('#clear-all-btn'),
    importBtn: $('#import-btn'),
    importInput: $('#import-input'),
    compactViewBtn: $('#compact-view-btn'),
    themeToggle: $('#theme-toggle-btn'),
    aboutBtn: $('#about-btn'),
    aboutPage: $('#about-page'),
    aboutOverlay: $('#about-overlay'),
    aboutBack: $('#about-back'),
    modal: $('#image-modal'),
    modalImage: $('#modal-image'),
    modalClose: $('#modal-close'),
    toastContainer: $('#toast-container'),
    // 导航栏任务状态
    navTaskBar: $('#nav-task-bar'),
    // 队列下拉
    queueTrigger: $('#queue-trigger-btn'),
    queueBadge: $('#queue-badge'),
    queuePanel: $('#queue-panel'),
    queuePanelBody: $('#queue-panel-body'),
    queuePanelCount: $('#queue-panel-count'),
    // 快速选择
    quickSelectBtn: $('#quick-select-btn'),
    quickSelectPanel: $('#quick-select-panel'),
    quickSelectClose: $('#quick-select-close'),
};

// ============ 初始化 ============

document.addEventListener('DOMContentLoaded', () => {
    // 重新获取可能在页面加载后才存在的 DOM 元素
    dom.quickSelectBtn = $('#quick-select-btn');
    dom.quickSelectPanel = $('#quick-select-panel');
    dom.quickSelectClose = $('#quick-select-close');
    
    loadSettings();
    loadHistory();
    renderPromptGroups();
    bindEvents();
    checkActiveJobs();
    startGlobalTimer();
});

function loadSettings() {
    const saved = localStorage.getItem('hunyuan_settings');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            if (s.apiUrl) dom.apiUrl.value = s.apiUrl;
            if (s.seed) dom.seed.value = s.seed;
            if (s.steps) dom.steps.value = s.steps;
            if (s.serverPrice) {
                dom.serverPrice.value = s.serverPrice;
                state.serverPrice = parseFloat(s.serverPrice) || 0;
            }
            if (s.ratio) state.ratio = s.ratio;
            if (s.resolution) state.resolution = s.resolution;
            if (s.count) state.count = s.count;
            if (s.refImages && Array.isArray(s.refImages)) {
                state.refImages = s.refImages;
                renderRefPreview();
            }
            $$('#ratio-options .segment-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.ratio === state.ratio);
            });
            $$('#resolution-options .segment-item').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.res) === state.resolution);
            });
            $$('#count-options .segment-item').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.count) === state.count);
            });
            if (s.parallel !== undefined) state.parallel = s.parallel;
            $$('#parallel-options .segment-item').forEach(btn => {
                btn.classList.toggle('active', (btn.dataset.parallel === 'true') === state.parallel);
            });
        } catch(e) {}
    }
    
    // 恢复紧凑视图状态
    const compactView = localStorage.getItem('hunyuan_compact_view') === 'true';
    state.compactView = compactView;
    dom.gallery.classList.toggle('compact', compactView);
    dom.compactViewBtn.classList.toggle('active', compactView);
    
    updateResolutionPreview();
}

function saveSettings() {
    localStorage.setItem('hunyuan_settings', JSON.stringify({
        apiUrl: dom.apiUrl.value,
        seed: dom.seed.value,
        steps: dom.steps.value,
        serverPrice: dom.serverPrice.value,
        ratio: state.ratio,
        resolution: state.resolution,
        count: state.count,
        parallel: state.parallel,
        refImages: state.refImages,
    }));
}

// ============ 快速选择渲染 ============

let currentGroupIndex = 0;

function renderPromptPanel() {
    const listContainer = $('#prompt-group-list');
    const chipsContainer = $('#prompt-chips');
    if (!listContainer || !chipsContainer) return;
    
    // 左侧分组列表
    listContainer.innerHTML = PROMPT_GROUPS.map((group, idx) => 
        `<div class="prompt-group-item${idx === currentGroupIndex ? ' active' : ''}" data-idx="${idx}">${group.name}</div>`
    ).join('');
    
    // 右侧标签
    renderPromptChips();
}

function renderPromptChips() {
    const container = $('#prompt-chips');
    if (!container || !PROMPT_GROUPS[currentGroupIndex]) return;
    
    const group = PROMPT_GROUPS[currentGroupIndex];
    container.innerHTML = group.prompts.map(p => 
        `<button class="chip" data-prompt="${escapeAttr(p.text)}">${p.label}</button>`
    ).join('');
}

function renderPromptGroups() {
    renderPromptPanel();
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 快速选择面板控制
function toggleQuickSelectPanel() {
    const panel = dom.quickSelectPanel;
    const btn = dom.quickSelectBtn;
    if (!panel || !btn) return;
    
    const isShown = panel.classList.contains('show');
    if (isShown) {
        closeQuickSelectPanel();
    } else {
        panel.classList.add('show');
        btn.classList.add('active');
    }
}

function closeQuickSelectPanel() {
    dom.quickSelectPanel?.classList.remove('show');
    dom.quickSelectBtn?.classList.remove('active');
}

// 手气不错 - 只填充提示词，不直接生成（面板内使用）
function luckyGeneratePromptOnly() {
    // 收集所有提示词
    const allPrompts = [];
    PROMPT_GROUPS.forEach(group => {
        group.prompts.forEach(p => allPrompts.push(p.text));
    });
    
    if (allPrompts.length === 0) {
        toast('没有可用的提示词', 'error');
        return;
    }
    
    // 随机选一个提示词
    const randomPrompt = allPrompts[Math.floor(Math.random() * allPrompts.length)];
    
    // 比例用 auto（服务端自动决定）
    state.ratio = 'auto';
    
    // 设置到表单
    dom.prompt.value = randomPrompt;
    
    // 更新 UI
    $$('#ratio-options .segment-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ratio === 'auto');
    });
    updateResolutionPreview();
    
    // 不关闭面板，让用户可以继续点击或手动生成
}

// 手气不错 - 随机选提示词，比例用 auto，直接生成（保留原函数兼容）
function luckyGenerate() {
    luckyGeneratePromptOnly();
    startGenerate();
}

// ============ 事件 ============

function bindEvents() {
    dom.generateBtn.addEventListener('click', startGenerate);

    $$('#ratio-options .segment-item').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#ratio-options .segment-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.ratio = btn.dataset.ratio;
            updateResolutionPreview();
            saveSettings();
        });
    });

    $$('#resolution-options .segment-item').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#resolution-options .segment-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.resolution = parseInt(btn.dataset.res);
            updateResolutionPreview();
            saveSettings();
        });
    });

    $$('#count-options .segment-item').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#count-options .segment-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.count = parseInt(btn.dataset.count);
            saveSettings();
        });
    });

    $$('#parallel-options .segment-item').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#parallel-options .segment-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.parallel = btn.dataset.parallel === 'true';
            saveSettings();
        });
    });

    // 左侧分组点击
    $('#prompt-group-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('.prompt-group-item');
        if (item && item.dataset.idx !== undefined) {
            currentGroupIndex = parseInt(item.dataset.idx);
            $$('.prompt-group-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            renderPromptChips();
        }
    });

    // 右侧 chip 点击（不关闭面板）
    $('#prompt-chips')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip && chip.dataset.prompt) {
            dom.prompt.value = chip.dataset.prompt;
            // 不关闭面板，保持打开状态让用户继续选择
        }
    });
    
    // 快速选择面板切换
    dom.quickSelectBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleQuickSelectPanel();
    });
    
    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
        if (dom.quickSelectPanel?.classList.contains('show')) {
            if (!dom.quickSelectPanel.contains(e.target) && !dom.quickSelectBtn?.contains(e.target)) {
                closeQuickSelectPanel();
            }
        }
    });
    
    // 点击关闭按钮关闭面板
    dom.quickSelectClose?.addEventListener('click', () => {
        closeQuickSelectPanel();
    });
    
    // ESC 关闭面板
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.quickSelectPanel?.classList.contains('show')) {
            closeQuickSelectPanel();
        }
    });
    
    // 手气不错 - 随机提示词 + auto 比例 + 直接生成（不关闭面板）
    $('#lucky-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        // 填充提示词并发起生成，但不关闭面板
        luckyGeneratePromptOnly();
        startGenerate();
    });
    
    // Gallery 事件委托（处理 card-footer 和 compact-info 点击还原）
    dom.gallery.addEventListener('click', (e) => {
        const restoreEl = e.target.closest('.card-footer[data-restore], .compact-info[data-restore]');
        if (restoreEl) {
            e.stopPropagation();
            const encodedData = restoreEl.dataset.restore;
            restoreSettings(encodedData, e);
        }
    });

    dom.clearAllBtn.addEventListener('click', async () => {
        if (!confirm('确定清空全部生成历史？')) return;
        try {
            await fetch('/api/images', { method: 'DELETE' });
            state.history = [];
            renderGallery();
            toast('已清空全部历史');
        } catch(e) {
            toast('清空失败', 'error');
        }
    });
    
    // 紧凑视图切换
    dom.compactViewBtn.addEventListener('click', () => {
        state.compactView = !state.compactView;
        dom.gallery.classList.toggle('compact', state.compactView);
        dom.compactViewBtn.classList.toggle('active', state.compactView);
        localStorage.setItem('hunyuan_compact_view', state.compactView);
    });

    dom.themeToggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('hunyuan_theme', next);
    });
    
    // 反馈按钮 - 滑出式关于页面
    const openAboutPage = () => {
        dom.aboutPage.classList.add('active');
        dom.aboutOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    };
    
    const closeAboutPage = () => {
        dom.aboutPage.classList.remove('active');
        dom.aboutOverlay.classList.remove('active');
        document.body.style.overflow = '';
    };
    
    if (dom.aboutBtn) {
        dom.aboutBtn.addEventListener('click', openAboutPage);
    }
    
    if (dom.aboutBack) {
        dom.aboutBack.addEventListener('click', closeAboutPage);
    }
    
    if (dom.aboutOverlay) {
        dom.aboutOverlay.addEventListener('click', closeAboutPage);
    }
    
    // 队列按钮
    dom.queueTrigger.addEventListener('click', toggleQueuePanel);

    dom.modalClose.addEventListener('click', closeModal);
    dom.modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    
    // Modal 导航按钮
    $('#modal-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        navigateModal('prev');
    });
    $('#modal-next').addEventListener('click', (e) => {
        e.stopPropagation();
        navigateModal('next');
    });
    
    // 键盘事件
    document.addEventListener('keydown', e => {
        if (!dom.modal.classList.contains('show')) return;
        
        switch (e.key) {
            case 'Escape':
                closeModal();
                break;
            case 'ArrowLeft':
                navigateModal('prev');
                break;
            case 'ArrowRight':
                navigateModal('next');
                break;
            case ' ':
                e.preventDefault();
                toggleRefImage();
                break;
        }
    });
    
    // 点击 Modal 左右区域切换图片
    dom.modal.querySelector('.modal-content').addEventListener('click', (e) => {
        // 如果点击的是图片本身，根据点击位置判断方向
        if (e.target === dom.modalImage || e.target.closest('.modal-main-image')) {
            const rect = dom.modal.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const width = rect.width;
            
            if (clickX < width * 0.3) {
                navigateModal('prev');
            } else if (clickX > width * 0.7) {
                navigateModal('next');
            }
        }
    });

    dom.apiUrl.addEventListener('change', saveSettings);
    dom.seed.addEventListener('change', saveSettings);
    dom.steps.addEventListener('change', saveSettings);
    dom.serverPrice.addEventListener('change', () => {
        state.serverPrice = parseFloat(dom.serverPrice.value) || 0;
        saveSettings();
        renderGallery();
    });

    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            startGenerate();
        }
    });

    const uploadZone = $('#upload-zone');
    const uploadInput = $('#upload-input');
    uploadZone.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', e => handleFiles(e.target.files));
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

// ============ 上传 ============

async function handleFiles(files) {
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const resp = await fetch('/api/upload', { method: 'POST', body: formData });
            const result = await resp.json();
            if (result.success) {
                state.refImages.push({ filename: result.filename, url: result.url });
                renderRefPreview();
                saveSettings();
            }
        } catch(e) {
            toast('上传失败', 'error');
        }
    }
    $('#upload-input').value = '';
}

function renderRefPreview() {
    const container = $('#ref-preview');
    if (state.refImages.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = state.refImages.map((img, idx) => {
        // 优先用 url，没有则用 filename 生成路径
        const imgUrl = img.url || `/uploads/${img.filename}`;
        return `
        <div class="ref-card">
            <img src="${imgUrl}" alt="参考图" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
            <div class="ref-error" style="display:none;">加载失败</div>
            <button class="ref-remove" onclick="removeRefImage(${idx})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `}).join('');
}

function removeRefImage(idx) {
    state.refImages.splice(idx, 1);
    renderRefPreview();
    saveSettings();
}

// ============ 全局计时器 ============

function startGlobalTimer() {
    setInterval(updateAllTaskTimers, 1000);
}

function updateAllTaskTimers() {
    Object.keys(state.activeTasks).forEach(taskId => {
        const task = state.activeTasks[taskId];
        if (!task.startedTs) return;
        
        const elapsed = Math.floor(Date.now() / 1000 - task.startedTs);
        
        // 更新导航栏中的计时器
        const navTimerEl = document.getElementById(`nav-timer-${taskId}`);
        if (navTimerEl) {
            navTimerEl.textContent = fmtSec(elapsed);
        }
        
        // 更新导航栏中的进度条
        const avg = getAvgDuration();
        if (avg > 0) {
            const expectedTotal = avg * (task.parallel ? 1 : task.count);
            const progress = Math.min((elapsed / expectedTotal) * 100, 95);
            
            const navProgressEl = document.getElementById(`nav-progress-${taskId}`);
            if (navProgressEl) {
                navProgressEl.style.width = `${progress}%`;
            }
        }
    });
}

function getAvgDuration() {
    const recent = state.history.filter(h => h.duration_sec > 0).slice(0, 20);
    if (recent.length === 0) return 0;
    return recent.reduce((s, h) => s + h.duration_sec, 0) / recent.length;
}

function fmtSec(s) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m${sec > 0 ? sec + 's' : ''}`;
}

// ============ 生成（支持多任务） ============

async function startGenerate() {
    const apiUrl = dom.apiUrl.value.trim();
    const prompt = dom.prompt.value.trim();
    const seed = parseInt(dom.seed.value) || 42;
    const steps = parseInt(dom.steps.value) || 50;

    if (!apiUrl) { toast('请输入 API 地址', 'error'); dom.apiUrl.focus(); return; }
    if (!prompt) { toast('请输入提示词', 'error'); dom.prompt.focus(); return; }

    saveSettings();

    // 生成唯一任务 ID（前端用）
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const modeLabel = state.parallel ? '并发' : '顺序';
    
    // 计算尺寸信息
    const dim = calcDimensions();
    const imageSize = getImageSizeParam();
    
    // 注册任务（startedTs 在真正开始生成时从后端 SSE 更新）
    state.activeTasks[taskId] = {
        prompt,
        count: state.count,
        parallel: state.parallel,
        queuedTs: Date.now() / 1000,   // 进队时间
        startedTs: null,               // 开始生成时间，从后端更新
        status: '排队中...',
        completed: 0,
        ratio: state.ratio,            // 比例
        width: dim.width,              // 实际宽度
        height: dim.height,            // 实际高度
        failed: false,                 // 是否失败
        error: null,                   // 错误信息
        refImages: state.refImages.map(img => img.filename),  // 垫图文件名列表
    };
    
    renderActiveTasks();
    toast(`任务已加入队列 (${state.count} 张, ${modeLabel})`);
    // 服务端宽高是反的，需要交换
    const params = {
        api_url: apiUrl, prompt, seed,
        image_size: imageSize, width: dim.height, height: dim.width,
        ratio: state.ratio,  // 用于恢复时显示
        actual_width: dim.width, actual_height: dim.height,  // 实际尺寸（未交换）
        steps, count: state.count,
        parallel: state.parallel,
        ref_images: state.refImages.map(img => img.filename),
    };
    console.log('[Generate] params:', params, '(实际输出:', dim.width, 'x', dim.height, ')');
    executeTask(taskId, params);
}

async function executeTask(taskId, params) {
    const task = state.activeTasks[taskId];
    if (!task) return;
    
    // 保存参数用于重试
    task.params = params;
    
    try {
        // 创建超时控制器
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);  // 30秒超时
        
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`服务器返回错误: HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '请求失败');
        }

        // 更新任务的服务端 job_id
        if (task) {
            task.jobId = result.job_id;
            task.queuePosition = result.queue_position;
            task.status = `排队中 #${result.queue_position}`;
            task.failed = false;
            task.error = null;
            renderActiveTasks();
        }
        
        // 启动轮询
        startTaskPolling();

    } catch(e) {
        // 解析错误类型
        let errorMsg = '未知错误';
        if (e.name === 'AbortError') {
            errorMsg = '请求超时';
        } else if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('fetch')) {
            errorMsg = '无法连接到服务器';
        } else if (e.message.includes('HTTP')) {
            errorMsg = e.message;
        } else {
            errorMsg = e.message;
        }
        
        // 标记为失败,保留任务
        if (task) {
            task.failed = true;
            task.error = errorMsg;
            task.status = '连接失败';
            renderActiveTasks();
        }
        
        toast('连接失败: ' + errorMsg, 'error');
        console.error('[executeTask] 失败:', e);
    }
}

// 重试失败的任务
async function retryTask(taskId) {
    const task = state.activeTasks[taskId];
    if (!task || !task.params) return;
    
    // 重置状态
    task.failed = false;
    task.error = null;
    task.status = '正在重试...';
    task.queuedTs = Date.now() / 1000;
    renderActiveTasks();
    
    toast('🔄 正在重试...', 'info');
    
    // 重新提交
    await executeTask(taskId, task.params);
}

// 轮询相关
let pollingTimer = null;
const POLL_INTERVAL = 2000;  // 2秒轮询一次

function startTaskPolling() {
    if (pollingTimer) return;  // 已经在轮询
    pollingTimer = setInterval(pollJobs, POLL_INTERVAL);
    pollJobs();  // 立即执行一次
}

function stopTaskPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
}

async function pollJobs() {
    const activeTasks = Object.entries(state.activeTasks);
    if (activeTasks.length === 0) {
        stopTaskPolling();
        return;
    }
    
    try {
        const resp = await fetch('/api/jobs');
        const result = await resp.json();
        if (!result.success) return;
        
        const serverJobs = result.data;
        const jobMap = {};
        serverJobs.forEach(j => jobMap[j.job_id] = j);
        
        // 更新每个本地任务状态
        for (const [taskId, task] of activeTasks) {
            if (!task.jobId) continue;
            
            const serverJob = jobMap[task.jobId];
            if (!serverJob) {
                // 服务端已无此任务，说明已完成（被过滤掉了）
                console.log('[Poll] 任务已完成，从服务端消失:', task.jobId);
                toast(`完成: ${task.prompt.slice(0, 20)}...`);
                removeTask(taskId);
                loadHistory();
                continue;
            }
            
            // 更新状态
            const prevCompleted = task.completed || 0;
            task.startedTs = serverJob.started_ts;
            task.completed = serverJob.completed || 0;
            
            if (serverJob.status === 'pending') {
                task.status = '排队中...';
            } else if (serverJob.status === 'generating') {
                if (task.completed > 0) {
                    task.status = `已完成 ${task.completed}/${task.count}`;
                } else {
                    task.status = '正在生成...';
                }
            } else if (serverJob.status === 'completed') {
                task.status = '完成';
            } else if (serverJob.status === 'error') {
                task.status = '失败';
                toast(serverJob.error || '生成失败', 'error');
            }
            
            // 处理新完成的结果
            const newResults = serverJob.results || [];
            if (newResults.length > prevCompleted) {
                for (let i = prevCompleted; i < newResults.length; i++) {
                    const r = newResults[i];
                    state.history.unshift({
                        id: Date.now() + Math.random(),
                        filename: r.filename,
                        url: r.url,
                        prompt: task.prompt,
                        info: r.info,
                        duration_sec: r.duration || 0,
                        batch_count: task.count,
                        seed: r.seed,
                        created_at: new Date().toISOString(),
                        width: task.width,
                        height: task.height,
                        ref_images: task.refImages || null,  // 垫图列表
                    });
                }
                renderGallery();
            }
            
            // 任务完成
            if (serverJob.status === 'completed') {
                const batchTotal = serverJob.batch_total || 0;
                
                // 回填 batch_total_sec
                state.history.forEach(h => {
                    if (!h._batchDone && h.prompt === task.prompt) {
                        h.batch_total_sec = batchTotal;
                        h.batch_count = task.count;
                        h._batchDone = true;
                    }
                });
                renderGallery();
                
                const costStr = calcBatchCost(batchTotal, task.count);
                toast(`完成: ${task.prompt.slice(0, 20)}... (${fmtSec(Math.round(batchTotal))}${costStr ? ', ' + costStr : ''})`);
                
                // 通知服务端确认完成
                fetch(`/api/job/${task.jobId}/ack`, { method: 'POST' }).catch(() => {});
                
                removeTask(taskId);
                loadHistory();
            }
        }
        
        renderActiveTasks();
        
    } catch(e) {
        console.error('轮询失败:', e);
    }
}

function removeTask(taskId) {
    delete state.activeTasks[taskId];
    renderActiveTasks();
}

// ============ 活跃任务渲染 ============

function renderActiveTasks() {
    const tasks = Object.entries(state.activeTasks);
    const totalTasks = tasks.length;
    
    // 分离正在生成、排队中和失败的任务
    const generating = [];
    const queued = [];
    const failed = [];
    tasks.forEach(([taskId, task]) => {
        if (task.failed) {
            failed.push([taskId, task]);
        } else if (task.startedTs) {
            generating.push([taskId, task]);
        } else {
            queued.push([taskId, task]);
        }
    });
    
    generating.sort((a, b) => (a[1].startedTs || 0) - (b[1].startedTs || 0));
    queued.sort((a, b) => (a[1].queuedTs || 0) - (b[1].queuedTs || 0));
    failed.sort((a, b) => (a[1].queuedTs || 0) - (b[1].queuedTs || 0));
    
    const avg = getAvgDuration();
    const avgHint = avg > 0 ? `~${fmtSec(Math.round(avg))}` : '';
    
    // ===== 1. 渲染导航栏中间的当前任务 =====
    let navHtml = '';
    
    // 显示失败任务提示
    if (failed.length > 0) {
        navHtml += `
            <div class="nav-task nav-task-failed" onclick="toggleQueuePanel()">
                <div class="nav-task-row">
                    <span class="nav-task-status">🔴 ${failed.length} 个任务连接失败</span>
                    <span class="nav-task-action">点击重试</span>
                </div>
            </div>
        `;
    }
    
    // 显示正在生成的任务
    if (generating.length > 0) {
        const [taskId, task] = generating[0];
        const elapsed = Math.floor(Date.now() / 1000 - task.startedTs);
        let progress = 0;
        if (avg > 0) {
            const expectedTotal = avg * (task.parallel ? 1 : task.count);
            progress = Math.min((elapsed / expectedTotal) * 100, 95);
        }
        
        navHtml += `
            <div class="nav-task" onclick="toggleQueuePanel()">
                <div class="nav-task-row">
                    <span class="nav-task-prompt">${escapeHtml(task.prompt)}</span>
                    <div class="nav-task-meta">
                        <span class="nav-task-timer" id="nav-timer-${taskId}">${fmtSec(elapsed)}</span>
                        ${avg > 0 ? `<span>/ ${avgHint}</span>` : ''}
                    </div>
                </div>
                <div class="nav-task-progress-row">
                    <button class="nav-task-cancel" onclick="cancelGeneratingTask('${taskId}', event)" title="取消生成">
                        <svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>
                    </button>
                    <div class="nav-task-progress">
                        <div class="nav-task-progress-bar" id="nav-progress-${taskId}" style="width: ${progress}%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    dom.navTaskBar.innerHTML = navHtml;
    
    // ===== 2. 更新队列下拉按钮状态 =====
    const totalQueueTasks = queued.length + failed.length;
    if (totalQueueTasks > 0) {
        dom.queueTrigger.classList.add('has-tasks');
        dom.queueBadge.textContent = totalQueueTasks;
        dom.queuePanelCount.textContent = `${totalQueueTasks} 个`;
        
        let queueHtml = '';
        
        // 渲染失败的任务（显示在最前面）
        failed.forEach(([taskId, task]) => {
            let sizeLabel = 'auto';
            if (task.ratio && task.ratio !== 'auto') {
                sizeLabel = `${task.ratio} ${task.width}×${task.height}`;
            }
            const modeLabel = task.parallel ? '并发' : '顺序';
            queueHtml += `
                <div class="queue-item queue-item-failed" data-task-id="${taskId}">
                    <div class="queue-left">
                        <span class="queue-status-icon">🔴</span>
                    </div>
                    <div class="queue-content">
                        <div class="queue-failed-header">
                            <span class="queue-failed-label">连接失败</span>
                        </div>
                        <span class="queue-prompt">${escapeHtml(task.prompt)}</span>
                        <span class="queue-meta">${task.count}张 · ${modeLabel} · ${sizeLabel}</span>
                        <span class="queue-error">${escapeHtml(task.error || '未知错误')}</span>
                    </div>
                    <div class="queue-actions">
                        <button class="queue-retry-btn" data-task-id="${taskId}" title="重试">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                            重试
                        </button>
                        <button class="queue-delete-btn" data-task-id="${taskId}" title="删除">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>
            `;
        });
        
        // 渲染排队任务到下拉面板
        queued.forEach(([taskId, task], idx) => {
            // 格式：auto 或 3:4 1080×1440
            let sizeLabel = 'auto';
            if (task.ratio && task.ratio !== 'auto') {
                sizeLabel = `${task.ratio} ${task.width}×${task.height}`;
            }
            // 只有不是第一个才显示置顶按钮
            const showPriority = idx > 0;
            queueHtml += `
                <div class="queue-item" data-task-id="${taskId}">
                    <div class="queue-left">
                        <span class="queue-num">#${idx + 1}</span>
                        ${showPriority ? `
                        <button class="queue-priority-btn" data-task-id="${taskId}" title="置顶（下一个执行）">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                        </button>
                        ` : ''}
                    </div>
                    <div class="queue-content">
                        <span class="queue-prompt">${escapeHtml(task.prompt)}</span>
                        <span class="queue-ratio">${sizeLabel}</span>
                    </div>
                    <button class="queue-delete-btn" data-task-id="${taskId}" title="取消任务">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `;
        });
        
        dom.queuePanelBody.innerHTML = queueHtml;
        
        // 绑定重试按钮事件
        dom.queuePanelBody.querySelectorAll('.queue-retry-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                retryTask(btn.dataset.taskId);
            });
        });
        
        // 绑定删除按钮事件
        dom.queuePanelBody.querySelectorAll('.queue-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.taskId;
                const task = state.activeTasks[taskId];
                if (task && task.failed) {
                    // 失败的任务直接删除
                    removeTask(taskId);
                } else {
                    // 排队中的任务取消
                    cancelQueuedTask(taskId);
                }
            });
        });
        
        // 绑定置顶按钮事件
        dom.queuePanelBody.querySelectorAll('.queue-priority-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                prioritizeTask(btn.dataset.taskId);
            });
        });
    } else {
        dom.queueTrigger.classList.remove('has-tasks');
        dom.queueBadge.textContent = '';
        dom.queuePanelCount.textContent = '';
        dom.queuePanelBody.innerHTML = '<div class="queue-panel-empty">暂无排队任务</div>';
    }
}

// 切换队列面板显示
function toggleQueuePanel() {
    dom.queuePanel.classList.toggle('open');
}

// 取消排队中的任务
async function cancelQueuedTask(taskId) {
    try {
        const task = state.activeTasks[taskId];
        const jobId = task?.jobId;
        
        if (jobId) {
            const response = await fetch(`/api/job/${jobId}`, { method: 'DELETE' });
            // 404 表示任务已不存在，也算成功
            if (!response.ok && response.status !== 404) {
                toast('取消失败', 'error');
                return;
            }
        }
        
        // 无论后端是否成功，都从前端移除
        delete state.activeTasks[taskId];
        renderActiveTasks();
        toast('已取消任务');
    } catch (e) {
        console.error('取消任务失败:', e);
        toast('取消失败', 'error');
    }
}

// 取消正在生成的任务
async function cancelGeneratingTask(taskId, event) {
    event.stopPropagation();
    
    const task = state.activeTasks[taskId];
    const jobId = task?.jobId;
    
    if (!jobId) {
        delete state.activeTasks[taskId];
        renderActiveTasks();
        return;
    }
    
    try {
        const response = await fetch(`/api/job/${jobId}/cancel`, { method: 'POST' });
        // 404 表示任务已不存在，也算成功
        if (response.ok || response.status === 404) {
            delete state.activeTasks[taskId];
            renderActiveTasks();
            toast('已取消生成');
        } else {
            toast('取消失败', 'error');
        }
    } catch (e) {
        console.error('取消生成失败:', e);
        toast('取消失败', 'error');
    }
}

// 置顶排队任务（移到队列最前）
async function prioritizeTask(taskId) {
    const task = state.activeTasks[taskId];
    const jobId = task?.jobId;
    
    if (!jobId) {
        toast('任务未就绪', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/job/${jobId}/priority`, { method: 'POST' });
        if (response.ok) {
            // 更新前端排序：把该任务的 queuedTs 改为最小（最早）
            task.queuedTs = 0;
            renderActiveTasks();
            toast('已置顶');
        } else if (response.status === 404) {
            // 任务在服务端已不存在，从前端移除
            delete state.activeTasks[taskId];
            renderActiveTasks();
            toast('任务已不存在', 'error');
        } else {
            const result = await response.json();
            toast(result.error || '置顶失败', 'error');
        }
    } catch (e) {
        console.error('置顶失败:', e);
        toast('置顶失败', 'error');
    }
}

// 点击外部关闭面板
document.addEventListener('click', (e) => {
    if (dom.queuePanel && dom.queuePanel.classList.contains('open')) {
        // 点击任务区域、队列按钮、面板本身不关闭
        const isTaskBar = e.target.closest('.nav-task');
        const isTrigger = e.target.closest('.queue-trigger');
        const isPanel = e.target.closest('.queue-panel');
        if (!isTaskBar && !isTrigger && !isPanel) {
            dom.queuePanel.classList.remove('open');
        }
    }
});

// ============ 历史 ============

async function loadHistory() {
    try {
        const resp = await fetch('/api/history');
        const result = await resp.json();
        if (result.success) {
            state.history = result.data.filter(item => item.status === 'completed' && item.filename);
            renderGallery();
        }
    } catch(e) {
        console.error('加载历史失败:', e);
    }
}

function renderGallery() {
    const items = state.history;
    const hasActiveTasks = Object.keys(state.activeTasks).length > 0;

    if (items.length === 0 && !hasActiveTasks) {
        dom.emptyState.style.display = '';
        dom.gallery.innerHTML = '';
        dom.imageCount.textContent = '';
        // 如果画廊为空且在画廊模式中，退出画廊模式
        if (galleryMode && galleryMode.active) {
            exitGalleryMode();
        }
        return;
    }

    dom.emptyState.style.display = 'none';
    dom.imageCount.textContent = `${items.length} 张`;
    
    // 如果在画廊模式选图中，使用选图渲染
    if (galleryMode && galleryMode.active) {
        renderGalleryForSelectMode();
        return;
    }

    dom.gallery.innerHTML = items.map(item => {
        const url = item.url || `/output/${item.filename}`;
        const time = formatTime(item.created_at);
        const prompt = item.prompt || '';
        const duration = item.duration_sec ? fmtSec(Math.round(item.duration_sec)) : '';
        const cost = calcImageCost(item);
        
        // 尺寸信息
        const w = item.width || 0;
        const h = item.height || 0;
        const sizeStr = (w && h) ? `${w}×${h}` : '';

        let metaParts = [];
        if (duration) metaParts.push(duration);
        if (cost) metaParts.push(cost);
        const metaStr = metaParts.join(' / ');
        const sizeBadge = sizeStr;

        // 序列化 item 数据用于还原
        const itemData = encodeURIComponent(JSON.stringify({
            prompt: item.prompt,
            seed: item.seed,
            image_size: item.image_size,
            width: item.width,
            height: item.height,
            steps: item.steps,
        }));
        
        // 转义 URL 中的单引号，防止 onclick 属性解析错误
        const safeUrl = url.replace(/'/g, "\\'");
        
        return `
            <div class="card" data-id="${item.id}" draggable="true">
                <div class="card-image">
                    <img src="${url}" alt="${escapeHtml(prompt)}" loading="lazy" onclick="openModal('${safeUrl}', ${item.id})">
                    <button class="card-delete-btn" onclick="deleteImage(${item.id}, event)" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                    <button class="card-ref-btn" onclick="useAsReference('${safeUrl}', event)" title="用作垫图">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </button>
                    ${metaStr ? `<div class="card-badge">${metaStr}</div>` : ''}
                    ${sizeBadge ? `<div class="card-badge card-badge-size">${sizeBadge}</div>` : ''}
                    <div class="card-overlay">
                        <div class="compact-top">
                            <div class="compact-badges">
                                ${metaStr ? `<span class="compact-meta">${metaStr}</span>` : ''}
                                ${sizeBadge ? `<span class="compact-size">${sizeBadge}</span>` : ''}
                            </div>
                            <div class="compact-actions">
                                <button class="compact-btn" onclick="useAsReference('${safeUrl}', event)" title="用作垫图">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                </button>
                                <a class="compact-btn" href="${url}" download title="下载" onclick="event.stopPropagation()">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                </a>
                                <button class="compact-btn danger" onclick="deleteImage(${item.id}, event)" title="删除">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="compact-info" data-restore="${itemData}" style="cursor: pointer;" title="点击还原设置">${escapeHtml(prompt)}</div>
                    </div>
                </div>
                <div class="card-footer" data-restore="${itemData}" style="cursor: pointer;" title="点击还原设置">
                    <div class="card-prompt">${escapeHtml(prompt)}</div>
                    <div class="card-meta">
                        <span class="card-time">${time}</span>
                        <a class="card-btn" href="${url}" download title="下载" onclick="event.stopPropagation()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============ 成本 ============

function calcImageCost(item) {
    if (!state.serverPrice) return '';
    const batchCount = item.batch_count || 1;
    const batchTotal = item.batch_total_sec || 0;
    const isParallel = item.parallel !== 0;  // 1 或 undefined 都算并发
    
    // 批次未完成时不显示成本
    if (!batchTotal && batchCount > 1) {
        return '';
    }
    
    let cost;
    if (isParallel && batchCount > 1 && batchTotal) {
        // 并发模式：整批耗时平摊
        cost = (batchTotal / 3600) * state.serverPrice / batchCount;
    } else {
        // 顺序模式或单张：用单张耗时独立计费
        if (!item.duration_sec) return '';
        cost = (item.duration_sec / 3600) * state.serverPrice;
    }
    
    if (cost < 0.01) return '<0.01元';
    return cost.toFixed(2) + '元';
}

function calcBatchCost(batchTotal, batchCount) {
    if (!state.serverPrice || !batchTotal) return '';
    const cost = (batchTotal / 3600) * state.serverPrice;
    if (cost < 0.01) return '<0.01元';
    return cost.toFixed(2) + '元';
}

// ============ 还原设置 ============

function restoreSettings(encodedData, event) {
    if (event) event.stopPropagation();
    try {
        const data = JSON.parse(decodeURIComponent(encodedData));
        console.log('[RestoreSettings]', data);
        
        // 还原提示词
        if (data.prompt) {
            dom.prompt.value = data.prompt;
        }
        
        // 还原 seed
        if (data.seed !== undefined && data.seed !== null) {
            dom.seed.value = data.seed;
        }
        
        // 还原 steps
        if (data.steps) {
            dom.steps.value = data.steps;
        }
        
        // 还原比例和分辨率
        const width = data.width || 1024;
        const height = data.height || 1024;
        
        // 计算比例
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const g = gcd(width, height);
        const ratioW = width / g;
        const ratioH = height / g;
        
        // 尝试匹配预设比例
        const ratioMap = {
            '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '16:9': [16, 9], '9:16': [9, 16],
            '3:2': [3, 2], '2:3': [2, 3], '21:9': [21, 9], '9:21': [9, 21]
        };
        let matchedRatio = 'auto';
        for (const [key, [rw, rh]] of Object.entries(ratioMap)) {
            if (ratioW === rw && ratioH === rh) {
                matchedRatio = key;
                break;
            }
        }
        
        // 设置比例
        state.ratio = matchedRatio;
        document.querySelectorAll('#ratio-options .btn-segment').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === matchedRatio);
        });
        
        // 设置分辨率（最长边）
        const longEdge = Math.max(width, height);
        const resolutionMap = { 768: '768', 1024: '1024', 1280: '1280', 1536: '1536', 2048: '2048', 4096: '4096' };
        let matchedRes = '1280';
        for (const [val, key] of Object.entries(resolutionMap)) {
            if (longEdge === parseInt(val)) {
                matchedRes = key;
                break;
            }
        }
        
        state.resolution = parseInt(matchedRes);
        document.querySelectorAll('#resolution-options .btn-segment').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === matchedRes);
        });
        
        // 更新分辨率预览
        updateResolutionPreview();
        
        toast('设置已还原');
        
        // 滚动到顶部
        document.querySelector('.main-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
        
    } catch(e) {
        console.error('还原设置失败:', e);
        toast('还原设置失败', 'error');
    }
}

// ============ 删除 ============

// 待删除队列 { id: { timer, item } }
const pendingDeletes = {};

function deleteImage(id, event) {
    event.stopPropagation();
    
    // 找到要删除的 item
    const item = state.history.find(i => i.id === id);
    if (!item) return;
    
    // 从列表中移除（UI 立即更新）
    state.history = state.history.filter(i => i.id !== id);
    renderGallery();
    
    // 设置 5 秒后真正删除
    const timer = setTimeout(async () => {
        delete pendingDeletes[id];
        try {
            await fetch(`/api/images/${id}`, { method: 'DELETE' });
        } catch(e) {
            console.error('删除失败:', e);
        }
    }, 5000);
    
    pendingDeletes[id] = { timer, item };
    
    // 显示可撤销的 toast
    showUndoToast(id, item.prompt);
}

function showUndoToast(id, prompt = '') {
    const container = $('#toast-container');
    const toastEl = document.createElement('div');
    toastEl.className = 'toast toast-undo';
    toastEl.dataset.deleteId = id;
    
    // 截取提示词前 10 个字符
    const promptPreview = prompt ? (prompt.length > 10 ? prompt.slice(0, 10) + '…' : prompt) : '';
    const promptText = promptPreview ? ` · ${promptPreview}` : '';
    
    toastEl.innerHTML = `
        <span>已删除${promptText}</span>
        <button class="undo-btn" onclick="undoDelete(${id}, event)">撤销</button>
        <div class="undo-progress"></div>
    `;
    container.appendChild(toastEl);
    
    // 5 秒后自动移除 toast
    setTimeout(() => {
        toastEl.remove();
    }, 5000);
}

function undoDelete(id, event) {
    event.stopPropagation();
    
    const pending = pendingDeletes[id];
    if (!pending) return;
    
    // 取消定时器
    clearTimeout(pending.timer);
    
    // 恢复到列表
    state.history.unshift(pending.item);
    state.history.sort((a, b) => b.id - a.id);  // 按 id 降序
    renderGallery();
    
    delete pendingDeletes[id];
    
    // 移除对应的 toast
    const toastEl = document.querySelector(`.toast-undo[data-delete-id="${id}"]`);
    if (toastEl) toastEl.remove();
    
    toast('已撤销删除');
}

// ============ 用作垫图 ============

async function useAsReference(url, event) {
    event.stopPropagation();
    try {
        // 获取图片 Blob
        const response = await fetch(url);
        const blob = await response.blob();
        
        // 创建 File 对象
        const filename = url.split('/').pop() || 'image.png';
        const file = new File([blob], filename, { type: blob.type });
        
        // 上传到后端
        const formData = new FormData();
        formData.append('file', file);
        
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();
        
        if (uploadData.success) {
            // 添加到 refImages（字段名与上传保持一致）
            state.refImages.push({
                filename: uploadData.filename,
                url: url
            });
            saveSettings();
            renderRefPreview();
            toast('已添加为垫图');
        } else {
            throw new Error(uploadData.error || '上传失败');
        }
    } catch(e) {
        console.error('添加垫图失败:', e);
        toast('添加失败', 'error');
    }
}

// ============ 模态框（图片浏览器） ============

// 图片浏览器状态
const imageViewer = {
    currentIndex: -1,       // 当前图片在 history 中的索引
    showingRef: false,      // 是否正在显示垫图
    currentRefIndex: 0,     // 当前显示的垫图索引（多张垫图时）
    lockedSize: null,       // 切换垫图时锁定的容器尺寸 {width, height}
};

function openModal(url, itemId) {
    // 根据 URL 或 itemId 找到对应的 history 索引
    let index = -1;
    if (itemId !== undefined) {
        index = state.history.findIndex(item => item.id === itemId);
    } else {
        // 通过 URL 匹配
        index = state.history.findIndex(item => {
            const itemUrl = item.url || `/output/${item.filename}`;
            return itemUrl === url || url.includes(item.filename);
        });
    }
    
    imageViewer.currentIndex = index >= 0 ? index : 0;
    imageViewer.showingRef = false;
    imageViewer.currentRefIndex = 0;
    imageViewer.lockedSize = null;
    
    // 清除容器的固定尺寸
    const mainImageContainer = dom.modal.querySelector('.modal-main-image');
    if (mainImageContainer) {
        mainImageContainer.style.width = '';
        mainImageContainer.style.height = '';
    }
    
    updateModalDisplay();
    dom.modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    dom.modal.classList.remove('show');
    document.body.style.overflow = '';
    imageViewer.showingRef = false;
}

function updateModalDisplay() {
    const item = state.history[imageViewer.currentIndex];
    if (!item) return;
    
    const mainUrl = item.url || `/output/${item.filename}`;
    
    // 解析 ref_images（可能是 JSON 字符串或数组）
    let refImages = [];
    if (item.ref_images) {
        if (typeof item.ref_images === 'string') {
            try {
                refImages = JSON.parse(item.ref_images);
            } catch (e) {
                refImages = [];
            }
        } else if (Array.isArray(item.ref_images)) {
            refImages = item.ref_images;
        }
    }
    
    const hasRef = refImages && refImages.length > 0;
    const refArea = $('#modal-ref-area');
    const refImagesContainer = $('#modal-ref-images');
    const counter = $('#modal-counter');
    const prevBtn = $('#modal-prev');
    const nextBtn = $('#modal-next');
    
    const mainImageContainer = dom.modal.querySelector('.modal-main-image');
    
    // 显示主图或垫图
    if (imageViewer.showingRef && hasRef) {
        // 切换到垫图前，先记录当前主图的显示尺寸
        if (!imageViewer.lockedSize) {
            const rect = dom.modalImage.getBoundingClientRect();
            imageViewer.lockedSize = { width: rect.width, height: rect.height };
        }
        
        // 显示垫图，使用锁定的尺寸
        const refUrl = `/uploads/${refImages[imageViewer.currentRefIndex]}`;
        dom.modalImage.src = refUrl;
        dom.modalImage.classList.add('showing-ref');
        
        // 固定容器尺寸
        if (imageViewer.lockedSize) {
            mainImageContainer.style.width = `${imageViewer.lockedSize.width}px`;
            mainImageContainer.style.height = `${imageViewer.lockedSize.height}px`;
            dom.modalImage.style.width = '100%';
            dom.modalImage.style.height = '100%';
            dom.modalImage.style.objectFit = 'contain';
        }
    } else {
        // 显示主图，清除锁定尺寸
        imageViewer.lockedSize = null;
        dom.modalImage.src = mainUrl;
        dom.modalImage.classList.remove('showing-ref');
        mainImageContainer.style.width = '';
        mainImageContainer.style.height = '';
        dom.modalImage.style.width = '';
        dom.modalImage.style.height = '';
        dom.modalImage.style.objectFit = '';
    }
    
    // 垫图预览区
    if (hasRef) {
        refArea.style.display = '';
        refImagesContainer.innerHTML = refImages.map((fname, idx) => {
            const active = imageViewer.showingRef && idx === imageViewer.currentRefIndex;
            return `<div class="modal-ref-thumb${active ? ' active' : ''}" data-idx="${idx}">
                <img src="/uploads/${fname}" alt="垫图 ${idx + 1}">
            </div>`;
        }).join('');
        
        // 绑定点击事件
        refImagesContainer.querySelectorAll('.modal-ref-thumb').forEach(thumb => {
            thumb.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(thumb.dataset.idx);
                imageViewer.currentRefIndex = idx;
                imageViewer.showingRef = true;
                updateModalDisplay();
            });
        });
    } else {
        refArea.style.display = 'none';
    }
    
    // 更新计数器
    const total = state.history.length;
    const current = imageViewer.currentIndex + 1;
    counter.textContent = `${current} / ${total}`;
    
    // 更新导航按钮状态
    prevBtn.style.opacity = imageViewer.currentIndex > 0 ? '' : '0.3';
    nextBtn.style.opacity = imageViewer.currentIndex < total - 1 ? '' : '0.3';
}

function navigateModal(direction) {
    const total = state.history.length;
    if (total === 0) return;
    
    // 切换图片时重置垫图状态和锁定尺寸
    imageViewer.showingRef = false;
    imageViewer.currentRefIndex = 0;
    imageViewer.lockedSize = null;
    
    // 清除容器的固定尺寸
    const mainImageContainer = dom.modal.querySelector('.modal-main-image');
    if (mainImageContainer) {
        mainImageContainer.style.width = '';
        mainImageContainer.style.height = '';
    }
    
    if (direction === 'prev' && imageViewer.currentIndex > 0) {
        imageViewer.currentIndex--;
        updateModalDisplay();
    } else if (direction === 'next' && imageViewer.currentIndex < total - 1) {
        imageViewer.currentIndex++;
        updateModalDisplay();
    }
}

function toggleRefImage() {
    const item = state.history[imageViewer.currentIndex];
    if (!item) return;
    
    // 解析 ref_images
    let refImages = [];
    if (item.ref_images) {
        if (typeof item.ref_images === 'string') {
            try {
                refImages = JSON.parse(item.ref_images);
            } catch (e) {
                refImages = [];
            }
        } else if (Array.isArray(item.ref_images)) {
            refImages = item.ref_images;
        }
    }
    
    if (!refImages || refImages.length === 0) {
        return; // 没有垫图，不切换
    }
    
    imageViewer.showingRef = !imageViewer.showingRef;
    updateModalDisplay();
}

// ============ Toast ============

function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(100%)';
        el.style.transition = 'all 0.3s';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ============ 工具 ============

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(str) {
    if (!str) return '';
    let d;
    if (str.includes('T')) {
        d = new Date(str);
    } else {
        d = new Date(str.replace(' ', 'T') + '+08:00');
    }
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hour = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    return `${month}/${day} ${hour}:${min}`;
}

// ============ 后台任务恢复 ============

async function checkActiveJobs() {
    try {
        const resp = await fetch('/api/jobs');
        const result = await resp.json();
        if (result.success && result.data.length > 0) {
            const jobs = result.data;
            // 将后端任务注册到前端状态
            jobs.forEach((job) => {
                const taskId = 'recover_' + job.job_id;
                const modeLabel = job.parallel ? '并发' : '顺序';
                state.activeTasks[taskId] = {
                    prompt: job.prompt || '恢复中...',
                    count: job.count || 1,
                    completed: job.completed || 0,
                    parallel: job.parallel,
                    queuedTs: job.queued_ts || (Date.now() / 1000),
                    startedTs: job.started_ts,  // 可能为 null
                    status: job.status === 'generating' ? '正在生成...' : '排队中...',
                    jobId: job.job_id,
                    recovered: true,
                    ratio: job.ratio || 'auto',
                    width: job.actual_width,
                    height: job.actual_height,
                    refImages: job.ref_images || null,  // 垫图列表
                };
            });
            renderActiveTasks();
            startTaskPolling();
        }
    } catch(e) {
        console.error('检查后台任务失败:', e);
    }
}

// ============ 画廊模式 ============

const galleryMode = {
    active: false,
    selectedImages: [],  // [{id, url, prompt}]
    maxSelect: 9,
};

// DOM 元素
const galleryModeDom = {
    btn: null,
    selectBar: null,
    selectCount: null,
    cancelBtn: null,
    confirmBtn: null,
    collageModal: null,
    collagePreview: null,
    showPromptCheckbox: null,
    closeBtn: null,
    backBtn: null,
    exportBtn: null,
    alignTools: null,
};

// 初始化画廊模式
function initGalleryMode() {
    galleryModeDom.btn = $('#gallery-mode-btn');
    galleryModeDom.selectBar = $('#gallery-select-bar');
    galleryModeDom.selectCount = $('#gallery-select-count');
    galleryModeDom.cancelBtn = $('#gallery-cancel-btn');
    galleryModeDom.confirmBtn = $('#gallery-confirm-btn');
    galleryModeDom.collageModal = $('#collage-modal');
    galleryModeDom.collagePreview = $('#collage-preview');
    galleryModeDom.showShadowCheckbox = $('#collage-show-shadow');
    galleryModeDom.showPromptCheckbox = $('#collage-show-prompt');
    galleryModeDom.layoutsContainer = $('#collage-layouts');
    galleryModeDom.closeBtn = $('#collage-close-btn');
    galleryModeDom.backBtn = $('#collage-back-btn');
    galleryModeDom.exportBtn = $('#collage-export-btn');
    galleryModeDom.alignTools = $('#align-tools');
    
    if (!galleryModeDom.btn) return;
    
    // 绑定事件
    galleryModeDom.btn.addEventListener('click', toggleGalleryMode);
    galleryModeDom.cancelBtn.addEventListener('click', exitGalleryMode);
    galleryModeDom.confirmBtn.addEventListener('click', openCollagePreview);
    galleryModeDom.closeBtn.addEventListener('click', closeCollageModal);
    galleryModeDom.backBtn.addEventListener('click', backToSelectMode);
    galleryModeDom.exportBtn.addEventListener('click', exportCollage);
    galleryModeDom.showShadowCheckbox.addEventListener('change', toggleShadowDisplay);
    galleryModeDom.showPromptCheckbox.addEventListener('change', togglePromptDisplay);
    
    // 排版切换
    galleryModeDom.layoutsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.collage-layout-item');
        if (!item) return;
        
        const layout = item.dataset.layout;
        galleryModeDom.layoutsContainer.querySelectorAll('.collage-layout-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        galleryMode.currentLayout = layout;
        applyLayout(layout);
    });
    
    // 对齐和分布按钮
    galleryModeDom.alignTools.addEventListener('click', (e) => {
        const btn = e.target.closest('.align-btn');
        if (!btn) return;
        
        const alignType = btn.dataset.align;
        const distributeType = btn.dataset.distribute;
        
        if (alignType) {
            alignSelectedImages(alignType);
        } else if (distributeType) {
            distributeSelectedImages(distributeType);
        }
    });
}

// 切换画廊模式
function toggleGalleryMode() {
    if (galleryMode.active) {
        exitGalleryMode();
        return;
    }
    
    if (state.history.length === 0) {
        toast('画廊中没有图片', 'error');
        return;
    }
    
    galleryMode.active = true;
    galleryMode.selectedImages = [];
    
    galleryModeDom.btn.classList.add('active');
    dom.gallery.classList.add('select-mode');
    galleryModeDom.selectBar.classList.add('show');
    
    updateSelectCount();
    renderGalleryForSelectMode();
}

// 退出画廊模式
function exitGalleryMode() {
    galleryMode.active = false;
    galleryMode.selectedImages = [];
    
    galleryModeDom.btn.classList.remove('active');
    dom.gallery.classList.remove('select-mode');
    galleryModeDom.selectBar.classList.remove('show');
    
    renderGallery();
}

// 更新选中计数
function updateSelectCount() {
    galleryModeDom.selectCount.textContent = galleryMode.selectedImages.length;
    galleryModeDom.confirmBtn.disabled = galleryMode.selectedImages.length === 0;
    
    // 更新卡片状态和序号
    const cards = dom.gallery.querySelectorAll('.card');
    const isFull = galleryMode.selectedImages.length >= galleryMode.maxSelect;
    
    cards.forEach(card => {
        const id = parseInt(card.dataset.id);
        const selectedIndex = galleryMode.selectedImages.findIndex(img => img.id === id);
        const isSelected = selectedIndex >= 0;
        
        card.classList.toggle('selected', isSelected);
        card.classList.toggle('disabled', !isSelected && isFull);
        
        // 更新序号
        const badge = card.querySelector('.select-badge-num');
        if (badge) {
            badge.textContent = isSelected ? selectedIndex + 1 : '';
        }
    });
}

// 渲染选图模式画廊
function renderGalleryForSelectMode() {
    const items = state.history;
    
    if (items.length === 0) {
        exitGalleryMode();
        return;
    }
    
    dom.gallery.innerHTML = items.map(item => {
        const url = item.url || `/output/${item.filename}`;
        const prompt = item.prompt || '';
        const selectedIndex = galleryMode.selectedImages.findIndex(img => img.id === item.id);
        const isSelected = selectedIndex >= 0;
        const isFull = galleryMode.selectedImages.length >= galleryMode.maxSelect;
        
        const cardClass = `card${isSelected ? ' selected' : ''}${!isSelected && isFull ? ' disabled' : ''}`;
        
        return `
            <div class="${cardClass}" data-id="${item.id}" data-url="${escapeAttr(url)}" data-prompt="${escapeAttr(prompt)}" onclick="toggleImageSelect(${item.id}, this)">
                <div class="card-image">
                    <img src="${url}" alt="${escapeHtml(prompt)}" loading="lazy">
                    <div class="select-badge">
                        <span class="select-badge-num">${isSelected ? selectedIndex + 1 : ''}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 切换图片选中状态
function toggleImageSelect(id, cardEl) {
    if (!galleryMode.active) return;
    
    const isSelected = galleryMode.selectedImages.some(img => img.id === id);
    
    if (isSelected) {
        // 取消选中
        galleryMode.selectedImages = galleryMode.selectedImages.filter(img => img.id !== id);
    } else {
        // 选中
        if (galleryMode.selectedImages.length >= galleryMode.maxSelect) {
            toast(`最多选择 ${galleryMode.maxSelect} 张图片`, 'error');
            return;
        }
        
        const url = cardEl.dataset.url;
        const prompt = cardEl.dataset.prompt;
        galleryMode.selectedImages.push({ id, url, prompt });
    }
    
    updateSelectCount();
}

// ============ 排版预览 ============

// 排版配置（微信朋友圈风格）
const COLLAGE_LAYOUTS = {
    1: [{ x: 0, y: 0, w: 100, h: 100 }],
    2: [
        { x: 0, y: 0, w: 49.5, h: 100 },
        { x: 50.5, y: 0, w: 49.5, h: 100 },
    ],
    3: [
        { x: 0, y: 0, w: 33, h: 100 },
        { x: 33.5, y: 0, w: 33, h: 100 },
        { x: 67, y: 0, w: 33, h: 100 },
    ],
    4: [
        { x: 0, y: 0, w: 49.5, h: 49.5 },
        { x: 50.5, y: 0, w: 49.5, h: 49.5 },
        { x: 0, y: 50.5, w: 49.5, h: 49.5 },
        { x: 50.5, y: 50.5, w: 49.5, h: 49.5 },
    ],
    5: [
        { x: 0, y: 0, w: 49.5, h: 49.5 },
        { x: 50.5, y: 0, w: 49.5, h: 49.5 },
        { x: 0, y: 50.5, w: 33, h: 49.5 },
        { x: 33.5, y: 50.5, w: 33, h: 49.5 },
        { x: 67, y: 50.5, w: 33, h: 49.5 },
    ],
    6: [
        { x: 0, y: 0, w: 33, h: 49.5 },
        { x: 33.5, y: 0, w: 33, h: 49.5 },
        { x: 67, y: 0, w: 33, h: 49.5 },
        { x: 0, y: 50.5, w: 33, h: 49.5 },
        { x: 33.5, y: 50.5, w: 33, h: 49.5 },
        { x: 67, y: 50.5, w: 33, h: 49.5 },
    ],
    7: [
        { x: 0, y: 0, w: 100, h: 33 },
        { x: 0, y: 33.5, w: 33, h: 33 },
        { x: 33.5, y: 33.5, w: 33, h: 33 },
        { x: 67, y: 33.5, w: 33, h: 33 },
        { x: 0, y: 67, w: 33, h: 33 },
        { x: 33.5, y: 67, w: 33, h: 33 },
        { x: 67, y: 67, w: 33, h: 33 },
    ],
    8: [
        { x: 0, y: 0, w: 49.5, h: 33 },
        { x: 50.5, y: 0, w: 49.5, h: 33 },
        { x: 0, y: 33.5, w: 33, h: 33 },
        { x: 33.5, y: 33.5, w: 33, h: 33 },
        { x: 67, y: 33.5, w: 33, h: 33 },
        { x: 0, y: 67, w: 33, h: 33 },
        { x: 33.5, y: 67, w: 33, h: 33 },
        { x: 67, y: 67, w: 33, h: 33 },
    ],
    9: [
        { x: 0, y: 0, w: 33, h: 33 },
        { x: 33.5, y: 0, w: 33, h: 33 },
        { x: 67, y: 0, w: 33, h: 33 },
        { x: 0, y: 33.5, w: 33, h: 33 },
        { x: 33.5, y: 33.5, w: 33, h: 33 },
        { x: 67, y: 33.5, w: 33, h: 33 },
        { x: 0, y: 67, w: 33, h: 33 },
        { x: 33.5, y: 67, w: 33, h: 33 },
        { x: 67, y: 67, w: 33, h: 33 },
    ],
};

// 图片位置状态（百分比坐标）
let collagePositions = [];

// 打开排版预览
async function openCollagePreview() {
    if (galleryMode.selectedImages.length === 0) return;
    
    galleryModeDom.collageModal.classList.add('show');
    galleryModeDom.showShadowCheckbox.checked = true;
    galleryModeDom.showPromptCheckbox.checked = false;
    galleryModeDom.collagePreview.classList.add('show-shadow');
    galleryModeDom.collagePreview.classList.remove('show-prompt');
    
    // 重置排版选择
    galleryModeDom.layoutsContainer.querySelectorAll('.collage-layout-item').forEach(i => i.classList.remove('active'));
    galleryModeDom.layoutsContainer.querySelector('[data-layout="auto"]').classList.add('active');
    galleryMode.currentLayout = 'auto';
    
    // 等待 Modal 渲染完成，确保能获取正确的尺寸
    // 使用延时确保 CSS 布局计算完成
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // 先调整画布尺寸
    resizeCollageCanvas();
    
    // 再加载图片获取尺寸，初始化位置
    await initCollagePositions();
    renderCollagePreview();
}

// 加载图片获取尺寸
function loadImageSize(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => resolve({ width: 1, height: 1 });
        img.src = url;
    });
}

// 初始化图片位置（根据数量和图片比例自动排布）
async function initCollagePositions() {
    // 加载所有图片尺寸（如果未加载）
    const needLoad = galleryMode.selectedImages.some(img => !img.aspectRatio);
    if (needLoad) {
        const sizes = await Promise.all(
            galleryMode.selectedImages.map(img => loadImageSize(img.url))
        );
        
        // 存储图片尺寸供后续使用
        galleryMode.selectedImages.forEach((img, idx) => {
            img.naturalWidth = sizes[idx].width;
            img.naturalHeight = sizes[idx].height;
            img.aspectRatio = sizes[idx].width / sizes[idx].height;
        });
    }
    
    // 获取预览区域尺寸
    const previewRect = galleryModeDom.collagePreview.getBoundingClientRect();
    let previewW = previewRect.width;
    let previewH = previewRect.height;
    
    // 检查尺寸有效性，如果太小则使用默认值
    if (previewW < 100 || previewH < 100) {
        // 使用 16:9 的默认尺寸
        previewW = 1600;
        previewH = 900;
    }
    
    // 计算合适的图片高度（根据图片数量，默认更大）
    const count = galleryMode.selectedImages.length;
    let targetHeight;
    if (count === 1) {
        targetHeight = previewH * 0.7;
    } else if (count === 2) {
        targetHeight = previewH * 0.6;
    } else if (count <= 4) {
        targetHeight = previewH * 0.45;
    } else if (count <= 6) {
        targetHeight = previewH * 0.4;
    } else {
        targetHeight = previewH * 0.35;
    }
    
    const gap = 16; // 像素间距
    const padding = 40; // 边距
    
    collagePositions = [];
    let currentX = padding;
    let currentY = padding;
    let rowHeight = 0;
    const maxWidth = previewW - padding;
    
    galleryMode.selectedImages.forEach((img, idx) => {
        const h = targetHeight;
        const w = h * img.aspectRatio;
        
        // 换行检测
        if (currentX + w > maxWidth && idx > 0) {
            currentX = padding;
            currentY += rowHeight + gap;
            rowHeight = 0;
        }
        
        // 转为百分比存储
        collagePositions.push({
            x: (currentX / previewW) * 100,
            y: (currentY / previewH) * 100,
            w: (w / previewW) * 100,
            h: (h / previewH) * 100,
        });
        
        rowHeight = Math.max(rowHeight, h);
        currentX += w + gap;
    });
}

// 关闭排版 Modal
function closeCollageModal() {
    galleryModeDom.collageModal.classList.remove('show');
}

// 返回选图模式
function backToSelectMode() {
    closeCollageModal();
}

// 切换阴影显示
function toggleShadowDisplay() {
    const show = galleryModeDom.showShadowCheckbox.checked;
    galleryModeDom.collagePreview.classList.toggle('show-shadow', show);
}

// 切换提示词显示
function togglePromptDisplay() {
    const show = galleryModeDom.showPromptCheckbox.checked;
    galleryModeDom.collagePreview.classList.toggle('show-prompt', show);
}

// 应用排版
function applyLayout(layoutType) {
    const previewRect = galleryModeDom.collagePreview.getBoundingClientRect();
    const previewW = previewRect.width;
    const previewH = previewRect.height;
    const padding = 40;
    const gap = 16;
    
    const images = galleryMode.selectedImages;
    const count = images.length;
    
    collagePositions = [];
    
    switch (layoutType) {
        case 'horizontal': {
            // 横向排列：所有图片在一行
            const availW = previewW - padding * 2 - gap * (count - 1);
            const h = previewH * 0.5;
            let totalRatio = 0;
            images.forEach(img => totalRatio += img.aspectRatio);
            
            let currentX = padding;
            images.forEach((img, idx) => {
                const w = (img.aspectRatio / totalRatio) * availW;
                collagePositions.push({
                    x: (currentX / previewW) * 100,
                    y: ((previewH - h) / 2 / previewH) * 100,
                    w: (w / previewW) * 100,
                    h: (h / previewH) * 100,
                });
                currentX += w + gap;
            });
            break;
        }
        
        case 'vertical': {
            // 纵向排列：所有图片在一列
            const availH = previewH - padding * 2 - gap * (count - 1);
            const hPerImg = availH / count;
            
            let currentY = padding;
            images.forEach((img, idx) => {
                const w = hPerImg * img.aspectRatio;
                collagePositions.push({
                    x: ((previewW - w) / 2 / previewW) * 100,
                    y: (currentY / previewH) * 100,
                    w: (w / previewW) * 100,
                    h: (hPerImg / previewH) * 100,
                });
                currentY += hPerImg + gap;
            });
            break;
        }
        
        case 'grid': {
            // 网格排列
            const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
            const rows = Math.ceil(count / cols);
            
            const cellW = (previewW - padding * 2 - gap * (cols - 1)) / cols;
            const cellH = (previewH - padding * 2 - gap * (rows - 1)) / rows;
            
            images.forEach((img, idx) => {
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                
                const x = padding + col * (cellW + gap);
                const y = padding + row * (cellH + gap);
                
                // 保持比例
                let w, h;
                if (img.aspectRatio > cellW / cellH) {
                    w = cellW;
                    h = cellW / img.aspectRatio;
                } else {
                    h = cellH;
                    w = cellH * img.aspectRatio;
                }
                
                collagePositions.push({
                    x: ((x + (cellW - w) / 2) / previewW) * 100,
                    y: ((y + (cellH - h) / 2) / previewH) * 100,
                    w: (w / previewW) * 100,
                    h: (h / previewH) * 100,
                });
            });
            break;
        }
        
        case 'masonry': {
            // 瀑布流：多列，按高度填充
            const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
            const colW = (previewW - padding * 2 - gap * (cols - 1)) / cols;
            const colHeights = Array(cols).fill(padding);
            
            images.forEach((img, idx) => {
                // 找最短列
                const minHeight = Math.min(...colHeights);
                const colIdx = colHeights.indexOf(minHeight);
                
                const x = padding + colIdx * (colW + gap);
                const y = colHeights[colIdx];
                const h = colW / img.aspectRatio;
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (colW / previewW) * 100,
                    h: (h / previewH) * 100,
                });
                
                colHeights[colIdx] += h + gap;
            });
            break;
        }
        
        case 'diagonal': {
            // 对角线排列：图片沿对角线分布
            const availW = previewW - padding * 2;
            const availH = previewH - padding * 2;
            const imgH = availH * 0.4;
            
            images.forEach((img, idx) => {
                const imgW = imgH * img.aspectRatio;
                const progress = count > 1 ? idx / (count - 1) : 0.5;
                
                const x = padding + progress * (availW - imgW);
                const y = padding + progress * (availH - imgH);
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            });
            break;
        }
        
        case 'stack': {
            // 堆叠排列：图片叠加在一起，有偏移
            const imgH = previewH * 0.6;
            const offsetX = 30; // 每张图片的 X 偏移
            const offsetY = 20; // 每张图片的 Y 偏移
            
            // 计算起始位置，使堆叠居中
            const totalOffsetX = offsetX * (count - 1);
            const totalOffsetY = offsetY * (count - 1);
            
            images.forEach((img, idx) => {
                const imgW = imgH * img.aspectRatio;
                const startX = (previewW - imgW - totalOffsetX) / 2;
                const startY = (previewH - imgH - totalOffsetY) / 2;
                
                const x = startX + idx * offsetX;
                const y = startY + idx * offsetY;
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            });
            break;
        }
        
        case 'scatter': {
            // 散落排列：随机位置和轻微旋转
            const imgH = previewH * 0.35;
            const usableW = previewW - padding * 2;
            const usableH = previewH - padding * 2;
            
            // 使用固定的伪随机种子，确保每次刷新结果一致
            const seed = count * 7 + 13;
            const random = (i) => {
                const x = Math.sin(seed + i * 9973) * 10000;
                return x - Math.floor(x);
            };
            
            images.forEach((img, idx) => {
                const imgW = imgH * img.aspectRatio;
                
                // 将画布分成网格区域，避免重叠过多
                const cols = Math.min(count, 3);
                const rows = Math.ceil(count / cols);
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                
                const cellW = usableW / cols;
                const cellH = usableH / rows;
                
                // 在格子内随机位置
                const baseX = padding + col * cellW;
                const baseY = padding + row * cellH;
                
                const x = baseX + random(idx * 2) * (cellW - imgW) * 0.8;
                const y = baseY + random(idx * 2 + 1) * (cellH - imgH) * 0.8;
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            });
            break;
        }
        
        case 'focus': {
            // 焦点排列：第一张大图，其余小图在下方
            if (count === 1) {
                // 单图居中
                const imgH = previewH * 0.8;
                const imgW = imgH * images[0].aspectRatio;
                collagePositions.push({
                    x: ((previewW - imgW) / 2 / previewW) * 100,
                    y: ((previewH - imgH) / 2 / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            } else {
                // 主图占上方 70%
                const mainH = previewH * 0.65;
                const mainW = mainH * images[0].aspectRatio;
                collagePositions.push({
                    x: ((previewW - mainW) / 2 / previewW) * 100,
                    y: (padding / previewH) * 100,
                    w: (mainW / previewW) * 100,
                    h: (mainH / previewH) * 100,
                });
                
                // 其余图片在下方排列
                const thumbCount = count - 1;
                const thumbH = previewH * 0.22;
                const thumbGap = gap;
                const thumbY = mainH + padding + thumbGap;
                
                // 计算缩略图总宽度
                let totalThumbW = 0;
                const thumbWidths = [];
                for (let i = 1; i < count; i++) {
                    const tw = thumbH * images[i].aspectRatio;
                    thumbWidths.push(tw);
                    totalThumbW += tw;
                }
                totalThumbW += thumbGap * (thumbCount - 1);
                
                let thumbX = (previewW - totalThumbW) / 2;
                for (let i = 1; i < count; i++) {
                    const tw = thumbWidths[i - 1];
                    collagePositions.push({
                        x: (thumbX / previewW) * 100,
                        y: (thumbY / previewH) * 100,
                        w: (tw / previewW) * 100,
                        h: (thumbH / previewH) * 100,
                    });
                    thumbX += tw + thumbGap;
                }
            }
            break;
        }
        
        case 'circle': {
            // 环形排列：图片围绕中心排列
            const centerX = previewW / 2;
            const centerY = previewH / 2;
            const radius = Math.min(previewW, previewH) * 0.32;
            const imgH = previewH * 0.25;
            
            images.forEach((img, idx) => {
                const imgW = imgH * img.aspectRatio;
                const angle = (idx / count) * Math.PI * 2 - Math.PI / 2; // 从顶部开始
                
                const x = centerX + Math.cos(angle) * radius - imgW / 2;
                const y = centerY + Math.sin(angle) * radius - imgH / 2;
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            });
            break;
        }
        
        case 'leftFocus': {
            // 左大右小：第一张占左侧大区域，其余在右侧垂直排列
            if (count === 1) {
                const imgH = previewH * 0.8;
                const imgW = imgH * images[0].aspectRatio;
                collagePositions.push({
                    x: ((previewW - imgW) / 2 / previewW) * 100,
                    y: ((previewH - imgH) / 2 / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            } else {
                // 主图占左侧 60%
                const mainW = (previewW - padding * 2 - gap) * 0.6;
                const mainH = previewH - padding * 2;
                const mainImgH = Math.min(mainH, mainW / images[0].aspectRatio);
                const mainImgW = mainImgH * images[0].aspectRatio;
                
                collagePositions.push({
                    x: (padding / previewW) * 100,
                    y: ((previewH - mainImgH) / 2 / previewH) * 100,
                    w: (mainImgW / previewW) * 100,
                    h: (mainImgH / previewH) * 100,
                });
                
                // 右侧小图
                const rightX = padding + mainW + gap;
                const rightW = previewW - rightX - padding;
                const thumbCount = count - 1;
                const thumbH = (previewH - padding * 2 - gap * (thumbCount - 1)) / thumbCount;
                
                for (let i = 1; i < count; i++) {
                    const tw = Math.min(rightW, thumbH * images[i].aspectRatio);
                    const th = tw / images[i].aspectRatio;
                    const ty = padding + (i - 1) * (thumbH + gap) + (thumbH - th) / 2;
                    
                    collagePositions.push({
                        x: ((rightX + (rightW - tw) / 2) / previewW) * 100,
                        y: (ty / previewH) * 100,
                        w: (tw / previewW) * 100,
                        h: (th / previewH) * 100,
                    });
                }
            }
            break;
        }
        
        case 'rightFocus': {
            // 右大左小：最后一张占右侧大区域，其余在左侧垂直排列
            if (count === 1) {
                const imgH = previewH * 0.8;
                const imgW = imgH * images[0].aspectRatio;
                collagePositions.push({
                    x: ((previewW - imgW) / 2 / previewW) * 100,
                    y: ((previewH - imgH) / 2 / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            } else {
                const mainIdx = count - 1;
                // 主图占右侧 60%
                const mainW = (previewW - padding * 2 - gap) * 0.6;
                const mainH = previewH - padding * 2;
                const mainImgH = Math.min(mainH, mainW / images[mainIdx].aspectRatio);
                const mainImgW = mainImgH * images[mainIdx].aspectRatio;
                
                // 左侧小图
                const leftW = previewW - padding * 2 - gap - mainW;
                const thumbCount = count - 1;
                const thumbH = (previewH - padding * 2 - gap * (thumbCount - 1)) / thumbCount;
                
                for (let i = 0; i < thumbCount; i++) {
                    const tw = Math.min(leftW, thumbH * images[i].aspectRatio);
                    const th = tw / images[i].aspectRatio;
                    const ty = padding + i * (thumbH + gap) + (thumbH - th) / 2;
                    
                    collagePositions.push({
                        x: ((padding + (leftW - tw) / 2) / previewW) * 100,
                        y: (ty / previewH) * 100,
                        w: (tw / previewW) * 100,
                        h: (th / previewH) * 100,
                    });
                }
                
                // 主图在右侧
                const mainX = padding + leftW + gap;
                collagePositions.push({
                    x: ((mainX + (mainW - mainImgW) / 2) / previewW) * 100,
                    y: ((previewH - mainImgH) / 2 / previewH) * 100,
                    w: (mainImgW / previewW) * 100,
                    h: (mainImgH / previewH) * 100,
                });
            }
            break;
        }
        
        case 'tShape': {
            // T型排列：顶部一行，下方一张大图
            if (count <= 2) {
                // 少量图片用横排
                const availW = previewW - padding * 2 - gap * (count - 1);
                const h = previewH * 0.5;
                let totalRatio = 0;
                images.forEach(img => totalRatio += img.aspectRatio);
                
                let currentX = padding;
                images.forEach((img, idx) => {
                    const w = (img.aspectRatio / totalRatio) * availW;
                    collagePositions.push({
                        x: (currentX / previewW) * 100,
                        y: ((previewH - h) / 2 / previewH) * 100,
                        w: (w / previewW) * 100,
                        h: (h / previewH) * 100,
                    });
                    currentX += w + gap;
                });
            } else {
                // 顶部小图
                const topCount = count - 1;
                const topH = previewH * 0.35;
                const topY = padding;
                
                let totalTopRatio = 0;
                for (let i = 0; i < topCount; i++) {
                    totalTopRatio += images[i].aspectRatio;
                }
                const availTopW = previewW - padding * 2 - gap * (topCount - 1);
                
                let currentX = padding;
                for (let i = 0; i < topCount; i++) {
                    const w = (images[i].aspectRatio / totalTopRatio) * availTopW;
                    const h = w / images[i].aspectRatio;
                    collagePositions.push({
                        x: (currentX / previewW) * 100,
                        y: ((topY + (topH - h) / 2) / previewH) * 100,
                        w: (w / previewW) * 100,
                        h: (h / previewH) * 100,
                    });
                    currentX += w + gap;
                }
                
                // 底部大图
                const bottomY = topY + topH + gap;
                const bottomH = previewH - bottomY - padding;
                const bottomImg = images[count - 1];
                const bottomW = bottomH * bottomImg.aspectRatio;
                
                collagePositions.push({
                    x: ((previewW - bottomW) / 2 / previewW) * 100,
                    y: (bottomY / previewH) * 100,
                    w: (bottomW / previewW) * 100,
                    h: (bottomH / previewH) * 100,
                });
            }
            break;
        }
        
        case 'filmStrip': {
            // 胶片排列：中间大两边小，有景深效果
            const centerIdx = Math.floor(count / 2);
            const maxH = previewH * 0.7;
            const minH = previewH * 0.4;
            
            images.forEach((img, idx) => {
                const distance = Math.abs(idx - centerIdx);
                const scale = 1 - distance * 0.15;
                const imgH = maxH * scale;
                const imgW = imgH * img.aspectRatio;
                
                // 计算 x 位置，使图片均匀分布
                const totalW = previewW - padding * 2;
                const step = totalW / (count + 1);
                const x = padding + step * (idx + 1) - imgW / 2;
                const y = (previewH - imgH) / 2;
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            });
            break;
        }
        
        case 'pyramid': {
            // 金字塔排列：上少下多
            const rows = [];
            let remaining = count;
            let row = 1;
            while (remaining > 0) {
                const inRow = Math.min(row, remaining);
                rows.push(inRow);
                remaining -= inRow;
                row++;
            }
            
            const totalRows = rows.length;
            const availH = previewH - padding * 2 - gap * (totalRows - 1);
            const rowH = availH / totalRows;
            
            let imgIdx = 0;
            rows.forEach((rowCount, rowIdx) => {
                const availW = previewW - padding * 2 - gap * (rowCount - 1);
                const cellW = availW / rowCount;
                const y = padding + rowIdx * (rowH + gap);
                
                for (let i = 0; i < rowCount; i++) {
                    if (imgIdx >= count) break;
                    const img = images[imgIdx];
                    
                    let w, h;
                    if (img.aspectRatio > cellW / rowH) {
                        w = cellW;
                        h = cellW / img.aspectRatio;
                    } else {
                        h = rowH;
                        w = rowH * img.aspectRatio;
                    }
                    
                    const x = padding + i * (cellW + gap) + (cellW - w) / 2;
                    
                    collagePositions.push({
                        x: (x / previewW) * 100,
                        y: ((y + (rowH - h) / 2) / previewH) * 100,
                        w: (w / previewW) * 100,
                        h: (h / previewH) * 100,
                    });
                    imgIdx++;
                }
            });
            break;
        }
        
        case 'wave': {
            // 波浪排列：图片沿正弦曲线分布
            const imgH = previewH * 0.35;
            const amplitude = previewH * 0.2; // 波浪振幅
            const centerY = previewH / 2;
            
            images.forEach((img, idx) => {
                const imgW = imgH * img.aspectRatio;
                const progress = count > 1 ? idx / (count - 1) : 0.5;
                
                const x = padding + progress * (previewW - padding * 2 - imgW);
                const y = centerY + Math.sin(progress * Math.PI * 2) * amplitude - imgH / 2;
                
                collagePositions.push({
                    x: (x / previewW) * 100,
                    y: (y / previewH) * 100,
                    w: (imgW / previewW) * 100,
                    h: (imgH / previewH) * 100,
                });
            });
            break;
        }
        
        case 'mosaic': {
            // 马赛克排列：大小不一的网格
            const cells = [];
            
            // 根据图片数量生成不同的马赛克布局
            if (count === 1) {
                cells.push({ x: 0, y: 0, w: 1, h: 1 });
            } else if (count === 2) {
                cells.push({ x: 0, y: 0, w: 0.6, h: 1 });
                cells.push({ x: 0.6, y: 0, w: 0.4, h: 1 });
            } else if (count === 3) {
                cells.push({ x: 0, y: 0, w: 0.6, h: 1 });
                cells.push({ x: 0.6, y: 0, w: 0.4, h: 0.5 });
                cells.push({ x: 0.6, y: 0.5, w: 0.4, h: 0.5 });
            } else if (count === 4) {
                cells.push({ x: 0, y: 0, w: 0.5, h: 0.6 });
                cells.push({ x: 0.5, y: 0, w: 0.5, h: 0.4 });
                cells.push({ x: 0, y: 0.6, w: 0.3, h: 0.4 });
                cells.push({ x: 0.3, y: 0.4, w: 0.7, h: 0.6 });
            } else if (count === 5) {
                cells.push({ x: 0, y: 0, w: 0.6, h: 0.5 });
                cells.push({ x: 0.6, y: 0, w: 0.4, h: 0.5 });
                cells.push({ x: 0, y: 0.5, w: 0.33, h: 0.5 });
                cells.push({ x: 0.33, y: 0.5, w: 0.33, h: 0.5 });
                cells.push({ x: 0.66, y: 0.5, w: 0.34, h: 0.5 });
            } else {
                // 6张及以上：2行3列变体
                const cols = 3;
                const rows = Math.ceil(count / cols);
                images.forEach((img, idx) => {
                    const col = idx % cols;
                    const row = Math.floor(idx / cols);
                    cells.push({
                        x: col / cols,
                        y: row / rows,
                        w: 1 / cols,
                        h: 1 / rows,
                    });
                });
            }
            
            const availW = previewW - padding * 2;
            const availH = previewH - padding * 2;
            
            images.forEach((img, idx) => {
                if (idx >= cells.length) return;
                const cell = cells[idx];
                
                const cellX = padding + cell.x * availW;
                const cellY = padding + cell.y * availH;
                const cellW = cell.w * availW - gap / 2;
                const cellH = cell.h * availH - gap / 2;
                
                // 保持比例
                let w, h;
                if (img.aspectRatio > cellW / cellH) {
                    w = cellW;
                    h = cellW / img.aspectRatio;
                } else {
                    h = cellH;
                    w = cellH * img.aspectRatio;
                }
                
                collagePositions.push({
                    x: ((cellX + (cellW - w) / 2) / previewW) * 100,
                    y: ((cellY + (cellH - h) / 2) / previewH) * 100,
                    w: (w / previewW) * 100,
                    h: (h / previewH) * 100,
                });
            });
            break;
        }
        
        default: // auto
            initCollagePositions();
            return;
    }
    
    renderCollagePreview();
}

// 渲染排版预览
function renderCollagePreview() {
    // 动态调整画布尺寸以占满空间
    resizeCollageCanvas();
    
    galleryModeDom.collagePreview.innerHTML = galleryMode.selectedImages.map((img, idx) => {
        const pos = collagePositions[idx];
        if (!pos) return '';
        
        return `
            <div class="collage-item" 
                 data-index="${idx}"
                 style="left: ${pos.x}%; top: ${pos.y}%; width: ${pos.w}%; height: ${pos.h}%;">
                <img src="${img.url}" alt="">
                <div class="collage-item-prompt">${escapeHtml(img.prompt)}</div>
            </div>
        `;
    }).join('');
    
    // 绑定拖拽事件
    bindCollageDragEvents();
}

// 动态调整画布尺寸
function resizeCollageCanvas() {
    const wrap = galleryModeDom.collagePreview.parentElement;
    const preview = galleryModeDom.collagePreview;
    
    if (!wrap) return;
    
    const wrapRect = wrap.getBoundingClientRect();
    let wrapWidth = wrapRect.width;
    let wrapHeight = wrapRect.height;
    
    // 检查尺寸有效性，如果太小则使用默认值
    if (wrapWidth < 100 || wrapHeight < 100) {
        // 使用窗口尺寸作为备用
        wrapWidth = window.innerWidth * 0.7;
        wrapHeight = window.innerHeight * 0.7;
    }
    
    const wrapRatio = wrapWidth / wrapHeight;
    const targetRatio = 16 / 9;
    
    let canvasWidth, canvasHeight;
    
    // 根据容器宽高比决定画布尺寸
    if (wrapRatio > targetRatio) {
        // 容器更宽，以高度为准
        canvasHeight = wrapHeight;
        canvasWidth = wrapHeight * targetRatio;
    } else {
        // 容器更高，以宽度为准
        canvasWidth = wrapWidth;
        canvasHeight = wrapWidth / targetRatio;
    }
    
    preview.style.width = `${canvasWidth}px`;
    preview.style.height = `${canvasHeight}px`;
}

// 监听窗口大小变化
window.addEventListener('resize', () => {
    if (galleryModeDom.collageModal?.classList.contains('show')) {
        resizeCollageCanvas();
    }
});

// 自由拖拽
let dragState = {
    active: false,
    index: null,
    indices: [],  // 批量拖拽的索引
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
    startPositions: [],  // 批量拖拽的起始位置
};

// 框选状态
let selectionState = {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
};

// 当前选中的图片索引（支持多选）
let selectedIndices = new Set();

// 操作历史（撤销/重做）
let operationHistory = [];
let historyIndex = -1;

// 画布缩放
let canvasScale = 1;

function bindCollageDragEvents() {
    const items = galleryModeDom.collagePreview.querySelectorAll('.collage-item');
    const preview = galleryModeDom.collagePreview;
    
    items.forEach(item => {
        // 点击选中
        item.addEventListener('click', (e) => {
            if (dragState.moved) return; // 拖拽时不触发选中
            
            const idx = parseInt(item.dataset.index);
            
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                // Shift/Ctrl 追加选择
                if (selectedIndices.has(idx)) {
                    selectedIndices.delete(idx);
                    item.classList.remove('selected');
                } else {
                    selectedIndices.add(idx);
                    item.classList.add('selected');
                }
            } else {
                // 单选
                if (selectedIndices.size === 1 && selectedIndices.has(idx)) {
                    // 再次点击取消选中
                    selectedIndices.clear();
                    items.forEach(i => i.classList.remove('selected'));
                } else {
                    selectedIndices.clear();
                    items.forEach(i => i.classList.remove('selected'));
                    selectedIndices.add(idx);
                    item.classList.add('selected');
                }
            }
            
            // 更新工具栏显示
            updateAlignToolsVisibility();
        });
        
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const idx = parseInt(item.dataset.index);
            
            // 如果点击的是已选中的图片，拖拽所有选中的图片
            if (selectedIndices.has(idx) && selectedIndices.size > 1) {
                // 批量拖拽
                dragState = {
                    active: true,
                    moved: false,
                    indices: Array.from(selectedIndices),
                    startX: e.clientX,
                    startY: e.clientY,
                    startPositions: Array.from(selectedIndices).map(i => ({
                        x: collagePositions[i].x,
                        y: collagePositions[i].y,
                    })),
                };
                
                selectedIndices.forEach(i => {
                    const el = preview.querySelector(`[data-index="${i}"]`);
                    if (el) el.classList.add('dragging');
                });
            } else {
                // 单图拖拽
                const pos = collagePositions[idx];
                
                dragState = {
                    active: true,
                    moved: false,
                    index: idx,
                    indices: [idx],
                    startX: e.clientX,
                    startY: e.clientY,
                    startPosX: pos.x,
                    startPosY: pos.y,
                    startPositions: [{ x: pos.x, y: pos.y }],
                };
                
                item.classList.add('dragging');
            }
            
            // 提升层级
            items.forEach(i => i.style.zIndex = '1');
            dragState.indices.forEach(i => {
                const el = preview.querySelector(`[data-index="${i}"]`);
                if (el) el.style.zIndex = '100';
            });
        });
    });
    
    // 画布上的 mousedown（用于框选）
    preview.addEventListener('mousedown', (e) => {
        // 如果点击的是图片，不触发框选
        if (e.target.closest('.collage-item')) return;
        
        e.preventDefault();
        const rect = preview.getBoundingClientRect();
        
        selectionState = {
            active: true,
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
            currentX: e.clientX - rect.left,
            currentY: e.clientY - rect.top,
        };
        
        // 如果没按 Shift，清空选择
        if (!e.shiftKey) {
            selectedIndices.clear();
            items.forEach(i => i.classList.remove('selected'));
        }
        
        // 创建选框元素
        const selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box';
        selectionBox.style.left = `${selectionState.startX}px`;
        selectionBox.style.top = `${selectionState.startY}px`;
        selectionBox.style.width = '0';
        selectionBox.style.height = '0';
        preview.appendChild(selectionBox);
    });
    
    // 全局 mousemove
    const onMouseMove = (e) => {
        const rect = preview.getBoundingClientRect();
        
        // 处理框选
        if (selectionState.active) {
            selectionState.currentX = e.clientX - rect.left;
            selectionState.currentY = e.clientY - rect.top;
            
            // 更新选框
            const selectionBox = preview.querySelector('.selection-box');
            if (selectionBox) {
                const left = Math.min(selectionState.startX, selectionState.currentX);
                const top = Math.min(selectionState.startY, selectionState.currentY);
                const width = Math.abs(selectionState.currentX - selectionState.startX);
                const height = Math.abs(selectionState.currentY - selectionState.startY);
                
                selectionBox.style.left = `${left}px`;
                selectionBox.style.top = `${top}px`;
                selectionBox.style.width = `${width}px`;
                selectionBox.style.height = `${height}px`;
                
                // 检测框内的图片
                const selectionRect = {
                    left,
                    top,
                    right: left + width,
                    bottom: top + height,
                };
                
                items.forEach(item => {
                    const itemRect = item.getBoundingClientRect();
                    const relativeRect = {
                        left: itemRect.left - rect.left,
                        top: itemRect.top - rect.top,
                        right: itemRect.right - rect.left,
                        bottom: itemRect.bottom - rect.top,
                    };
                    
                    const idx = parseInt(item.dataset.index);
                    const isInSelection = !(
                        relativeRect.right < selectionRect.left ||
                        relativeRect.left > selectionRect.right ||
                        relativeRect.bottom < selectionRect.top ||
                        relativeRect.top > selectionRect.bottom
                    );
                    
                    if (isInSelection) {
                        selectedIndices.add(idx);
                        item.classList.add('selected');
                    } else if (!e.shiftKey) {
                        selectedIndices.delete(idx);
                        item.classList.remove('selected');
                    }
                });
            }
            return;
        }
        
        // 处理拖拽
        if (!dragState.active) return;
        
        // 标记已移动
        if (Math.abs(e.clientX - dragState.startX) > 3 || Math.abs(e.clientY - dragState.startY) > 3) {
            dragState.moved = true;
        }
        
        const deltaX = ((e.clientX - dragState.startX) / rect.width) * 100;
        const deltaY = ((e.clientY - dragState.startY) / rect.height) * 100;
        
        // 批量移动
        dragState.indices.forEach((idx, i) => {
            const pos = collagePositions[idx];
            pos.x = dragState.startPositions[i].x + deltaX;
            pos.y = dragState.startPositions[i].y + deltaY;
            
            // 直接更新 DOM 位置
            const item = preview.querySelector(`[data-index="${idx}"]`);
            if (item) {
                item.style.left = `${pos.x}%`;
                item.style.top = `${pos.y}%`;
            }
        });
    };
    
    // 全局 mouseup
    const onMouseUp = () => {
        // 处理框选结束
        if (selectionState.active) {
            const selectionBox = preview.querySelector('.selection-box');
            if (selectionBox) {
                selectionBox.remove();
            }
            selectionState.active = false;
            updateAlignToolsVisibility();
            return;
        }
        
        // 处理拖拽结束
        if (!dragState.active) return;
        
        // 移除拖拽状态
        dragState.indices.forEach(idx => {
            const item = preview.querySelector(`[data-index="${idx}"]`);
            if (item) {
                item.classList.remove('dragging');
            }
        });
        
        // 如果移动了，保存到历史
        if (dragState.moved) {
            saveHistory();
        }
        
        dragState.active = false;
        dragState.index = null;
        dragState.indices = [];
    };
    
    // 移除旧监听器，添加新的（绑定到 document，允许鼠标超出画布）
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // 滚轮缩放（选中的图片）
    items.forEach(item => {
        item.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const idx = parseInt(item.dataset.index);
            
            // 只缩放选中的图片
            if (!selectedIndices.has(idx)) return;
            
            // 缩放比例
            const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
            const minScale = 5; // 最小 5%
            const maxScale = 150; // 最大 150%
            
            // 批量缩放所有选中的图片
            selectedIndices.forEach(i => {
                const pos = collagePositions[i];
                
                const newW = Math.max(minScale, Math.min(maxScale, pos.w * scaleFactor));
                const newH = Math.max(minScale, Math.min(maxScale, pos.h * scaleFactor));
                
                // 以中心点缩放
                const dw = newW - pos.w;
                const dh = newH - pos.h;
                pos.x -= dw / 2;
                pos.y -= dh / 2;
                pos.w = newW;
                pos.h = newH;
                
                // 更新 DOM
                const el = preview.querySelector(`[data-index="${i}"]`);
                if (el) {
                    el.style.left = `${pos.x}%`;
                    el.style.top = `${pos.y}%`;
                    el.style.width = `${pos.w}%`;
                    el.style.height = `${pos.h}%`;
                }
            });
            
            // 保存历史
            saveHistory();
        }, { passive: false });
    });
    
    // 画布整体缩放（未选中任何图片时）
    preview.addEventListener('wheel', (e) => {
        // 如果有选中图片，由图片自己处理
        if (selectedIndices.size > 0) return;
        
        e.preventDefault();
        
        const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
        canvasScale = Math.max(0.5, Math.min(3, canvasScale * scaleFactor));
        
        // 缩放所有图片
        collagePositions.forEach((pos, idx) => {
            const centerX = 50;
            const centerY = 50;
            
            // 相对于中心点缩放
            pos.x = centerX + (pos.x - centerX) * scaleFactor + (pos.w * (scaleFactor - 1)) / 2;
            pos.y = centerY + (pos.y - centerY) * scaleFactor + (pos.h * (scaleFactor - 1)) / 2;
            pos.w *= scaleFactor;
            pos.h *= scaleFactor;
            
            const item = preview.querySelector(`[data-index="${idx}"]`);
            if (item) {
                item.style.left = `${pos.x}%`;
                item.style.top = `${pos.y}%`;
                item.style.width = `${pos.w}%`;
                item.style.height = `${pos.h}%`;
            }
        });
        
        // 保存历史
        saveHistory();
    }, { passive: false });
    
    // 点击空白处取消选中
    preview.addEventListener('click', (e) => {
        if (e.target === preview) {
            items.forEach(i => i.classList.remove('selected'));
            selectedItemIndex = null;
        }
    });
}

// ============ 导出 PNG ============

async function exportCollage() {
    const showShadow = galleryModeDom.showShadowCheckbox.checked;
    const showPrompt = galleryModeDom.showPromptCheckbox.checked;
    const scale = parseInt(document.getElementById('collage-export-scale').value) || 2;
    
    // 加载所有图片
    const loadImage = (url) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    };
    
    try {
        galleryModeDom.exportBtn.disabled = true;
        galleryModeDom.exportBtn.textContent = '导出中...';
        
        // 先加载所有图片
        const loadedImages = [];
        for (let idx = 0; idx < galleryMode.selectedImages.length; idx++) {
            const imgData = galleryMode.selectedImages[idx];
            const pos = collagePositions[idx];
            if (!pos) continue;
            
            const img = await loadImage(imgData.url);
            loadedImages.push({ img, imgData, pos });
        }
        
        // 基准尺寸（用于百分比计算），乘以分辨率倍数
        const BASE_WIDTH = 1920 * scale;
        const BASE_HEIGHT = 1080 * scale;
        
        // 创建 Canvas（使用完整画布尺寸，与预览一致）
        const canvas = document.createElement('canvas');
        canvas.width = BASE_WIDTH;
        canvas.height = BASE_HEIGHT;
        const ctx = canvas.getContext('2d');
        
        // 填充白色背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        
        // 绘制图片
        for (let i = 0; i < loadedImages.length; i++) {
            const { img, imgData, pos } = loadedImages[i];
            
            // 计算图片在 box 内的实际位置（contain 模式）
            const boxX = (pos.x / 100) * BASE_WIDTH;
            const boxY = (pos.y / 100) * BASE_HEIGHT;
            const boxW = (pos.w / 100) * BASE_WIDTH;
            const boxH = (pos.h / 100) * BASE_HEIGHT;
            
            const imgScale = Math.min(boxW / img.width, boxH / img.height);
            const drawW = img.width * imgScale;
            const drawH = img.height * imgScale;
            const drawX = boxX + (boxW - drawW) / 2;
            const drawY = boxY + (boxH - drawH) / 2;
            
            // 绘制带圆角的图片
            ctx.save();
            
            // 设置阴影
            if (showShadow) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
                ctx.shadowBlur = 20 * scale;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 4 * scale;
            }
            
            // 创建圆角裁剪路径
            const radius = 6 * scale;
            ctx.beginPath();
            ctx.roundRect(drawX, drawY, drawW, drawH, radius);
            ctx.clip();
            
            // 绘制图片
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
            
            ctx.restore();
            
            // 绘制提示词（使用裁剪确保不超出图片边界）
            if (showPrompt && imgData.prompt) {
                ctx.save();
                
                // 创建圆角裁剪路径（与图片圆角一致）
                const radius = 6 * scale;
                ctx.beginPath();
                ctx.roundRect(drawX, drawY, drawW, drawH, radius);
                ctx.clip();
                
                const promptHeight = 28 * scale;
                const promptY = drawY + drawH - promptHeight;
                
                // 半透明背景
                const gradient = ctx.createLinearGradient(drawX, promptY - 16 * scale, drawX, drawY + drawH);
                gradient.addColorStop(0, 'rgba(0,0,0,0)');
                gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
                ctx.fillStyle = gradient;
                ctx.fillRect(drawX, promptY - 16 * scale, drawW, promptHeight + 16 * scale);
                
                // 文字
                ctx.fillStyle = '#ffffff';
                ctx.font = `${13 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
                ctx.textBaseline = 'middle';
                
                const text = truncateText(ctx, imgData.prompt, drawW - 16 * scale);
                ctx.fillText(text, drawX + 8 * scale, promptY + promptHeight / 2);
                
                ctx.restore();
            }
        }
        
        // 导出
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `collage_${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            
            toast('导出成功');
            galleryModeDom.exportBtn.disabled = false;
            galleryModeDom.exportBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                导出 PNG
            `;
        }, 'image/png');
        
    } catch (e) {
        console.error('导出失败:', e);
        toast('导出失败', 'error');
        galleryModeDom.exportBtn.disabled = false;
        galleryModeDom.exportBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出 PNG
        `;
    }
}

// 保持原比例绘制图片（contain 模式），返回实际绘制区域
function drawImageContain(ctx, img, boxX, boxY, boxW, boxH) {
    const imgRatio = img.width / img.height;
    const boxRatio = boxW / boxH;
    
    let drawW, drawH, drawX, drawY;
    
    if (imgRatio > boxRatio) {
        // 图片更宽，以宽度为准
        drawW = boxW;
        drawH = boxW / imgRatio;
        drawX = boxX;
        drawY = boxY + (boxH - drawH) / 2;
    } else {
        // 图片更高，以高度为准
        drawH = boxH;
        drawW = boxH * imgRatio;
        drawX = boxX + (boxW - drawW) / 2;
        drawY = boxY;
    }
    
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    
    return { x: drawX, y: drawY, w: drawW, h: drawH };
}

// 截断文本
function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
        truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
}

// 更新对齐工具栏显示状态
function updateAlignToolsVisibility() {
    if (galleryModeDom.alignTools) {
        if (selectedIndices.size >= 2) {
            galleryModeDom.alignTools.style.display = 'flex';
        } else {
            galleryModeDom.alignTools.style.display = 'none';
        }
    }
}

// 保存操作历史
function saveHistory() {
    // 移除当前位置之后的历史
    operationHistory = operationHistory.slice(0, historyIndex + 1);
    
    // 保存当前状态
    operationHistory.push({
        positions: JSON.parse(JSON.stringify(collagePositions)),
        selectedImages: [...galleryMode.selectedImages],
    });
    
    historyIndex++;
    
    // 限制历史记录数量
    if (operationHistory.length > 50) {
        operationHistory.shift();
        historyIndex--;
    }
}

// 撤销
function undo() {
    if (historyIndex <= 0) {
        toast('没有可撤销的操作', 'info');
        return;
    }
    
    historyIndex--;
    const state = operationHistory[historyIndex];
    
    // 恢复位置
    collagePositions = JSON.parse(JSON.stringify(state.positions));
    galleryMode.selectedImages = [...state.selectedImages];
    
    // 重新渲染
    renderCollagePreview();
    toast('已撤销');
}

// 重做
function redo() {
    if (historyIndex >= operationHistory.length - 1) {
        toast('没有可重做的操作', 'info');
        return;
    }
    
    historyIndex++;
    const state = operationHistory[historyIndex];
    
    // 恢复位置
    collagePositions = JSON.parse(JSON.stringify(state.positions));
    galleryMode.selectedImages = [...state.selectedImages];
    
    // 重新渲染
    renderCollagePreview();
    toast('已重做');
}

// 删除选中的图片
function deleteSelectedImages() {
    if (selectedIndices.size === 0) return;
    
    // 不能删除到只剩 0 张
    if (galleryMode.selectedImages.length - selectedIndices.size < 1) {
        toast('至少保留 1 张图片', 'error');
        return;
    }
    
    // 确认删除
    if (selectedIndices.size > 1) {
        if (!confirm(`确定要删除选中的 ${selectedIndices.size} 张图片吗？`)) {
            return;
        }
    }
    
    // 保存历史
    saveHistory();
    
    // 删除图片
    const indicesToDelete = Array.from(selectedIndices).sort((a, b) => b - a);
    indicesToDelete.forEach(idx => {
        galleryMode.selectedImages.splice(idx, 1);
        collagePositions.splice(idx, 1);
    });
    
    // 清空选择
    selectedIndices.clear();
    
    // 重新渲染
    renderCollagePreview();
    applyCollageLayout(galleryMode.layoutMode);
    
    toast(`已删除 ${indicesToDelete.length} 张图片`);
}

// 对齐选中的图片
function alignSelectedImages(type) {
    if (selectedIndices.size < 2) return;
    
    const preview = galleryModeDom.collagePreview;
    const rect = preview.getBoundingClientRect();
    
    // 获取所有选中图片的位置信息
    const items = Array.from(selectedIndices).map(idx => {
        const pos = collagePositions[idx];
        const item = preview.querySelector(`[data-index="${idx}"]`);
        const itemRect = item ? item.getBoundingClientRect() : null;
        
        return {
            idx,
            pos,
            left: pos.x,
            right: pos.x + pos.w,
            top: pos.y,
            bottom: pos.y + pos.h,
            centerX: pos.x + pos.w / 2,
            centerY: pos.y + pos.h / 2,
        };
    });
    
    // 保存历史
    saveHistory();
    
    switch (type) {
        case 'left':
            const minLeft = Math.min(...items.map(i => i.left));
            items.forEach(i => {
                i.pos.x = minLeft;
            });
            break;
            
        case 'center-h':
            const avgCenterX = items.reduce((sum, i) => sum + i.centerX, 0) / items.length;
            items.forEach(i => {
                i.pos.x = avgCenterX - i.pos.w / 2;
            });
            break;
            
        case 'right':
            const maxRight = Math.max(...items.map(i => i.right));
            items.forEach(i => {
                i.pos.x = maxRight - i.pos.w;
            });
            break;
            
        case 'top':
            const minTop = Math.min(...items.map(i => i.top));
            items.forEach(i => {
                i.pos.y = minTop;
            });
            break;
            
        case 'center-v':
            const avgCenterY = items.reduce((sum, i) => sum + i.centerY, 0) / items.length;
            items.forEach(i => {
                i.pos.y = avgCenterY - i.pos.h / 2;
            });
            break;
            
        case 'bottom':
            const maxBottom = Math.max(...items.map(i => i.bottom));
            items.forEach(i => {
                i.pos.y = maxBottom - i.pos.h;
            });
            break;
    }
    
    // 更新 DOM
    items.forEach(i => {
        const item = preview.querySelector(`[data-index="${i.idx}"]`);
        if (item) {
            item.style.left = `${i.pos.x}%`;
            item.style.top = `${i.pos.y}%`;
        }
    });
    
    toast('已对齐');
}

// 分布选中的图片
function distributeSelectedImages(type) {
    if (selectedIndices.size < 3) {
        toast('至少选择 3 张图片才能分布', 'info');
        return;
    }
    
    const preview = galleryModeDom.collagePreview;
    
    // 获取所有选中图片的位置信息
    const items = Array.from(selectedIndices).map(idx => {
        const pos = collagePositions[idx];
        return {
            idx,
            pos,
            left: pos.x,
            right: pos.x + pos.w,
            top: pos.y,
            bottom: pos.y + pos.h,
            centerX: pos.x + pos.w / 2,
            centerY: pos.y + pos.h / 2,
        };
    });
    
    // 保存历史
    saveHistory();
    
    if (type === 'horizontal') {
        // 按中心 X 坐标排序
        items.sort((a, b) => a.centerX - b.centerX);
        
        const first = items[0];
        const last = items[items.length - 1];
        const totalSpace = last.centerX - first.centerX;
        const spacing = totalSpace / (items.length - 1);
        
        items.forEach((item, i) => {
            const newCenterX = first.centerX + spacing * i;
            item.pos.x = newCenterX - item.pos.w / 2;
        });
    } else if (type === 'vertical') {
        // 按中心 Y 坐标排序
        items.sort((a, b) => a.centerY - b.centerY);
        
        const first = items[0];
        const last = items[items.length - 1];
        const totalSpace = last.centerY - first.centerY;
        const spacing = totalSpace / (items.length - 1);
        
        items.forEach((item, i) => {
            const newCenterY = first.centerY + spacing * i;
            item.pos.y = newCenterY - item.pos.h / 2;
        });
    }
    
    // 更新 DOM
    items.forEach(i => {
        const item = preview.querySelector(`[data-index="${i.idx}"]`);
        if (item) {
            item.style.left = `${i.pos.x}%`;
            item.style.top = `${i.pos.y}%`;
        }
    });
    
    toast('已分布');
}

// 初始化键盘快捷键
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // 只在画廊模式的排版预览中生效
        if (!galleryModeDom.collageModal.classList.contains('show')) return;
        
        const preview = galleryModeDom.collagePreview;
        const items = preview.querySelectorAll('.collage-item');
        
        // 全选
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            selectedIndices.clear();
            items.forEach((item, idx) => {
                selectedIndices.add(idx);
                item.classList.add('selected');
            });
            updateAlignToolsVisibility();
            return;
        }
        
        // 撤销
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            undo();
            return;
        }
        
        // 重做
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
            e.preventDefault();
            redo();
            return;
        }
        
        // 删除
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (selectedIndices.size > 0) {
                deleteSelectedImages();
            }
            return;
        }
        
        // Esc 取消选择
        if (e.key === 'Escape') {
            selectedIndices.clear();
            items.forEach(i => i.classList.remove('selected'));
            updateAlignToolsVisibility();
            return;
        }
        
        // 方向键移动
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if (selectedIndices.size === 0) return;
            
            const step = e.shiftKey ? 10 : 1; // Shift 加速
            const rect = preview.getBoundingClientRect();
            let deltaX = 0, deltaY = 0;
            
            if (e.key === 'ArrowLeft') deltaX = -(step / rect.width) * 100;
            if (e.key === 'ArrowRight') deltaX = (step / rect.width) * 100;
            if (e.key === 'ArrowUp') deltaY = -(step / rect.height) * 100;
            if (e.key === 'ArrowDown') deltaY = (step / rect.height) * 100;
            
            selectedIndices.forEach(idx => {
                const pos = collagePositions[idx];
                pos.x += deltaX;
                pos.y += deltaY;
                
                const item = preview.querySelector(`[data-index="${idx}"]`);
                if (item) {
                    item.style.left = `${pos.x}%`;
                    item.style.top = `${pos.y}%`;
                }
            });
            
            saveHistory();
        }
    });
}

// ============ 画廊拖拽排序 ============

let galleryDragState = {
    dragging: false,
    draggedEl: null,
    draggedId: null,
    targetCard: null,
    insertBefore: true,
};

function initGalleryDrag() {
    const gallery = dom.gallery;
    if (!gallery) return;
    
    // 创建或获取指示线元素
    let indicator = document.getElementById('drag-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'drag-indicator';
        indicator.className = 'drag-indicator';
        document.body.appendChild(indicator);
    }
    
    function showIndicator(targetCard, above) {
        if (!targetCard) {
            indicator.style.display = 'none';
            return;
        }
        
        const rect = targetCard.getBoundingClientRect();
        const scrollLeft = window.scrollX || window.pageXOffset;
        const scrollTop = window.scrollY || window.pageYOffset;
        
        // 水平指示线：在卡片上方或下方
        const left = rect.left + scrollLeft;
        const top = above ? (rect.top + scrollTop - 2) : (rect.bottom + scrollTop - 2);
        
        indicator.style.cssText = `
            display: block;
            position: absolute;
            width: ${rect.width}px;
            height: 4px;
            top: ${top}px;
            left: ${left}px;
            background: #3b82f6;
            border-radius: 2px;
            z-index: 10000;
            pointer-events: none;
            box-shadow: 0 0 8px #3b82f6;
        `;
    }
    
    function hideIndicator() {
        indicator.style.display = 'none';
    }
    
    function findTargetCard(e) {
        const cards = [...gallery.querySelectorAll('.card:not(.dragging)')];
        
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            
            // 检查鼠标是否在卡片范围内
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                
                // 上下判断：鼠标在卡片上半部分则插入到上方，下半部分则插入到下方
                const centerY = rect.top + rect.height / 2;
                return {
                    card,
                    insertBefore: e.clientY < centerY
                };
            }
        }
        
        // 找最近的卡片
        let closest = null;
        let closestDist = Infinity;
        
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
            
            if (dist < closestDist) {
                closestDist = dist;
                closest = card;
            }
        }
        
        if (closest && closestDist < 150) {
            const rect = closest.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            return {
                card: closest,
                insertBefore: e.clientY < centerY
            };
        }
        
        return null;
    }
    
    gallery.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.card');
        if (!card || galleryMode.active) return;
        
        galleryDragState.dragging = true;
        galleryDragState.draggedEl = card;
        galleryDragState.draggedId = card.dataset.id;
        
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
        
        setTimeout(() => {
            card.classList.add('dragging');
        }, 0);
    });
    
    gallery.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!galleryDragState.dragging) return;
        
        e.dataTransfer.dropEffect = 'move';
        
        const result = findTargetCard(e);
        
        if (result && result.card.dataset.id !== galleryDragState.draggedId) {
            galleryDragState.targetCard = result.card;
            galleryDragState.insertBefore = result.insertBefore;
            showIndicator(result.card, result.insertBefore);
        } else {
            galleryDragState.targetCard = null;
            hideIndicator();
        }
    });
    
    gallery.addEventListener('dragleave', (e) => {
        if (!gallery.contains(e.relatedTarget)) {
            hideIndicator();
        }
    });
    
    gallery.addEventListener('dragend', async (e) => {
        if (!galleryDragState.dragging) return;
        
        const draggedEl = galleryDragState.draggedEl;
        const targetCard = galleryDragState.targetCard;
        
        draggedEl.classList.remove('dragging');
        hideIndicator();
        
        if (targetCard && targetCard !== draggedEl) {
            const draggedId = parseInt(galleryDragState.draggedId);
            const targetId = parseInt(targetCard.dataset.id);
            
            // 更新 state.history 顺序
            const draggedIndex = state.history.findIndex(item => item.id === draggedId);
            const targetIndex = state.history.findIndex(item => item.id === targetId);
            
            if (draggedIndex !== -1 && targetIndex !== -1) {
                const [draggedItem] = state.history.splice(draggedIndex, 1);
                
                // 重新计算目标索引（因为已经移除了拖拽项）
                let newTargetIndex = state.history.findIndex(item => item.id === targetId);
                
                if (galleryDragState.insertBefore) {
                    state.history.splice(newTargetIndex, 0, draggedItem);
                } else {
                    state.history.splice(newTargetIndex + 1, 0, draggedItem);
                }
                
                // 重新渲染并保存
                renderGallery();
                await saveGalleryOrder();
            }
        }
        
        // 重置状态
        galleryDragState.dragging = false;
        galleryDragState.draggedEl = null;
        galleryDragState.draggedId = null;
        galleryDragState.targetCard = null;
    });
    
    // drop 事件需要阻止默认行为
    gallery.addEventListener('drop', (e) => {
        e.preventDefault();
    });
}

async function saveGalleryOrder() {
    const order = state.history.map(item => item.id);
    try {
        const res = await fetch('/api/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });
        const data = await res.json();
        if (!data.success) {
            console.error('保存排序失败:', data.error);
        }
    } catch (err) {
        console.error('保存排序失败:', err);
    }
}

// ============ 图片导入功能 ============

function initGalleryImport() {
    const gallery = dom.gallery;
    const importBtn = dom.importBtn;
    const importInput = dom.importInput;
    
    if (!gallery || !importBtn || !importInput) return;
    
    // 点击导入按钮
    importBtn.addEventListener('click', () => {
        importInput.click();
    });
    
    // 选择文件后上传
    importInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        await uploadImagesToGallery(files);
        importInput.value = ''; // 清空以便重复选择
    });
    
    // 监听画廊区域的拖拽（外部文件拖入）
    const workspaceBody = document.getElementById('workspace-body');
    if (!workspaceBody) return;
    
    workspaceBody.addEventListener('dragover', (e) => {
        // 如果是内部卡片拖拽，不处理
        if (galleryDragState.dragging) return;
        
        // 检查是否有文件
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            workspaceBody.classList.add('drag-file-over');
        }
    });
    
    workspaceBody.addEventListener('dragleave', (e) => {
        if (!workspaceBody.contains(e.relatedTarget)) {
            workspaceBody.classList.remove('drag-file-over');
        }
    });
    
    workspaceBody.addEventListener('drop', async (e) => {
        // 如果是内部卡片拖拽，不处理
        if (galleryDragState.dragging) return;
        
        workspaceBody.classList.remove('drag-file-over');
        
        // 检查是否有文件
        if (!e.dataTransfer.types.includes('Files')) return;
        
        e.preventDefault();
        
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) {
            toast('请拖入图片文件', 'error');
            return;
        }
        
        await uploadImagesToGallery(files);
    });
}

async function uploadImagesToGallery(files) {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
        toast('没有可导入的图片', 'error');
        return;
    }
    
    toast(`正在导入 ${imageFiles.length} 张图片...`, 'info');
    
    let successCount = 0;
    const newRecords = [];
    
    for (const file of imageFiles) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const res = await fetch('/api/import', {
                method: 'POST',
                body: formData
            });
            
            const data = await res.json();
            
            if (data.success && data.data) {
                newRecords.push(data.data);
                successCount++;
            } else {
                console.error('导入失败:', file.name, data.error);
            }
        } catch (err) {
            console.error('导入失败:', file.name, err);
        }
    }
    
    if (successCount > 0) {
        // 将新记录插入到 history 最前面
        state.history = [...newRecords.reverse(), ...state.history];
        renderGallery();
        toast(`成功导入 ${successCount} 张图片`, 'success');
    } else {
        toast('导入失败', 'error');
    }
}

// 在 DOMContentLoaded 中初始化
document.addEventListener('DOMContentLoaded', () => {
    initGalleryMode();
    initKeyboardShortcuts();
    initGalleryDrag();
    initGalleryImport();
});
