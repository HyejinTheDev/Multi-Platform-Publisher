/* ============================================
   VideoBlast - Frontend Application Logic
   ============================================ */

(function () {
    'use strict';

    // ---- State ----
    const state = {
        selectedFile: null,
        selectedPlatforms: new Set(),
        platformStatus: { youtube: false, facebook: false, tiktok: false },
        isUploading: false,
        currentUploadId: null,
        authUrls: {}
    };

    // ---- DOM Elements ----
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        uploadZone: $('#uploadZone'),
        uploadZoneContent: $('#uploadZoneContent'),
        uploadPreview: $('#uploadPreview'),
        videoPreview: $('#videoPreview'),
        fileInfo: $('#fileInfo'),
        fileInput: $('#fileInput'),
        browseBtn: $('#browseBtn'),
        removeFileBtn: $('#removeFileBtn'),
        videoTitle: $('#videoTitle'),
        videoDescription: $('#videoDescription'),
        videoTags: $('#videoTags'),
        titleCount: $('#titleCount'),
        descCount: $('#descCount'),
        uploadBtn: $('#uploadBtn'),
        uploadHint: $('#uploadHint'),
        progressCard: $('#progressCard'),
        progressList: $('#progressList'),
        resultsCard: $('#resultsCard'),
        resultsList: $('#resultsList'),
        newUploadBtn: $('#newUploadBtn'),
        connectionIndicators: $('#connectionIndicators'),
        toastContainer: $('#toastContainer')
    };

    // Platform icons (emoji shortcuts)
    const platformIcons = {
        youtube: '▶️',
        facebook: '📘',
        tiktok: '🎵'
    };

    const platformNames = {
        youtube: 'YouTube',
        facebook: 'Facebook',
        tiktok: 'TikTok'
    };

    // ---- Initialize ----
    function init() {
        setupDragDrop();
        setupFileInput();
        setupPlatformToggles();
        setupFormListeners();
        setupUploadButton();
        setupConnectButtons();
        setupNewUploadButton();
        fetchStatus();
        fetchAuthUrls();
        checkUrlParams();
        renderConnectionIndicators();
    }

    // ---- Drag & Drop ----
    function setupDragDrop() {
        const zone = dom.uploadZone;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            zone.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(evt => {
            zone.addEventListener(evt, () => zone.classList.add('drag-over'));
        });

        ['dragleave', 'drop'].forEach(evt => {
            zone.addEventListener(evt, () => zone.classList.remove('drag-over'));
        });

        zone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) handleFile(files[0]);
        });

        zone.addEventListener('click', (e) => {
            if (e.target.id !== 'removeFileBtn' && !e.target.closest('.btn-remove-file')) {
                dom.fileInput.click();
            }
        });
    }

    // ---- File Input ----
    function setupFileInput() {
        dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleFile(e.target.files[0]);
        });

        dom.removeFileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearFile();
        });
    }

    function handleFile(file) {
        const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
        if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|avi)$/i)) {
            showToast('Chỉ hỗ trợ file video (MP4, WebM, MOV, AVI)', 'error');
            return;
        }

        if (file.size > 500 * 1024 * 1024) {
            showToast('File quá lớn! Tối đa 500MB', 'error');
            return;
        }

        state.selectedFile = file;

        // Show preview
        dom.uploadZoneContent.style.display = 'none';
        dom.uploadPreview.style.display = 'block';

        const videoUrl = URL.createObjectURL(file);
        dom.videoPreview.src = videoUrl;
        dom.videoPreview.play().catch(() => { });

        dom.fileInfo.innerHTML = `
      <span class="file-name">${file.name}</span>
      <span>•</span>
      <span>${formatSize(file.size)}</span>
    `;

        updateUploadButton();
        showToast(`📁 Đã chọn: ${file.name}`, 'info');
    }

    function clearFile() {
        state.selectedFile = null;
        dom.fileInput.value = '';
        dom.uploadZoneContent.style.display = 'block';
        dom.uploadPreview.style.display = 'none';
        dom.videoPreview.src = '';
        dom.fileInfo.innerHTML = '';
        updateUploadButton();
    }

    // ---- Platform Toggles ----
    function setupPlatformToggles() {
        ['youtube', 'facebook', 'tiktok'].forEach(platform => {
            const checkbox = $(`#toggle${capitalize(platform)}`);
            const card = $(`#platform${capitalize(platform)}`);

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    state.selectedPlatforms.add(platform);
                    card.classList.add('selected');
                } else {
                    state.selectedPlatforms.delete(platform);
                    card.classList.remove('selected');
                }
                updateUploadButton();
            });
        });
    }

    // ---- Connect Buttons ----
    function setupConnectButtons() {
        ['youtube', 'facebook', 'tiktok'].forEach(platform => {
            const btn = $(`#connect${capitalize(platform)}`);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (state.platformStatus[platform]) {
                    disconnectPlatform(platform);
                } else {
                    connectPlatform(platform);
                }
            });
        });
    }

    async function connectPlatform(platform) {
        if (state.authUrls[platform]) {
            window.location.href = state.authUrls[platform];
        } else {
            showToast(`⚠️ ${platformNames[platform]} chưa được cấu hình API. Vui lòng điền credentials vào file .env`, 'warning');
        }
    }

    async function disconnectPlatform(platform) {
        try {
            await fetch(`/api/auth/disconnect/${platform}`, { method: 'POST' });
        } catch (e) { /* ignore */ }

        state.platformStatus[platform] = false;
        updatePlatformUI(platform, false);
        showToast(`${platformNames[platform]} đã ngắt kết nối`, 'info');
    }

    function updatePlatformUI(platform, connected) {
        const statusEl = $(`#status${capitalize(platform)}`);
        const btnEl = $(`#connect${capitalize(platform)}`);

        if (connected) {
            statusEl.textContent = '✓ Đã kết nối';
            statusEl.classList.add('connected');
            btnEl.classList.add('connected');
            btnEl.querySelector('.btn-text').textContent = 'Ngắt kết nối';
        } else {
            statusEl.textContent = 'Chưa kết nối';
            statusEl.classList.remove('connected');
            btnEl.classList.remove('connected');
            btnEl.querySelector('.btn-text').textContent = 'Kết nối';
        }

        renderConnectionIndicators();
    }

    // ---- Form Listeners ----
    function setupFormListeners() {
        dom.videoTitle.addEventListener('input', () => {
            dom.titleCount.textContent = dom.videoTitle.value.length;
        });

        dom.videoDescription.addEventListener('input', () => {
            dom.descCount.textContent = dom.videoDescription.value.length;
        });
    }

    // ---- Upload Button ----
    function setupUploadButton() {
        dom.uploadBtn.addEventListener('click', startUpload);
    }

    function updateUploadButton() {
        const hasFile = !!state.selectedFile;
        const hasPlatforms = state.selectedPlatforms.size > 0;
        dom.uploadBtn.disabled = !hasFile || !hasPlatforms || state.isUploading;

        if (!hasFile && !hasPlatforms) {
            dom.uploadHint.textContent = 'Chọn file video và ít nhất 1 nền tảng để bắt đầu';
        } else if (!hasFile) {
            dom.uploadHint.textContent = 'Chọn hoặc kéo thả file video để bắt đầu';
        } else if (!hasPlatforms) {
            dom.uploadHint.textContent = 'Bật ít nhất 1 nền tảng để đăng video';
        } else {
            const names = [...state.selectedPlatforms].map(p => platformNames[p]).join(', ');
            dom.uploadHint.textContent = `Sẵn sàng đăng lên ${names}`;
        }
    }

    // ---- Upload Flow ----
    async function startUpload() {
        if (!state.selectedFile || state.selectedPlatforms.size === 0) return;

        state.isUploading = true;
        dom.uploadBtn.disabled = true;
        dom.uploadBtn.querySelector('.btn-upload-content span').textContent = 'Đang tải lên...';

        const platforms = [...state.selectedPlatforms];

        // Show progress card
        dom.progressCard.style.display = 'block';
        dom.progressCard.classList.add('fade-in');
        dom.resultsCard.style.display = 'none';

        // Render initial progress items
        dom.progressList.innerHTML = platforms.map(p => `
      <div class="progress-item" id="progress-${p}">
        <div class="progress-item-icon ${p}">${platformIcons[p]}</div>
        <div class="progress-item-info">
          <div class="progress-item-name">${platformNames[p]}</div>
          <div class="progress-bar-container">
            <div class="progress-bar ${p}" id="bar-${p}" style="width: 0%"></div>
          </div>
        </div>
        <span class="progress-item-percent" id="percent-${p}">0%</span>
        <span class="progress-item-status pending" id="status-item-${p}">Đang chờ</span>
      </div>
    `).join('');

        // Build form data
        const formData = new FormData();
        formData.append('video', state.selectedFile);
        formData.append('title', dom.videoTitle.value || state.selectedFile.name.replace(/\.[^.]+$/, ''));
        formData.append('description', dom.videoDescription.value);
        formData.append('tags', dom.videoTags.value);
        formData.append('platforms', JSON.stringify(platforms));
        formData.append('youtubePrivacy', $('#youtubePrivacy').value);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Upload failed');
            }

            state.currentUploadId = data.uploadId;

            // Start polling progress
            pollProgress(data.uploadId, platforms);

        } catch (err) {
            showToast(`❌ Lỗi: ${err.message}`, 'error');
            resetUploadState();
        }
    }

    async function pollProgress(uploadId, platforms) {
        const poll = async () => {
            try {
                const res = await fetch(`/api/upload/progress/${uploadId}`);
                const data = await res.json();

                if (data.platforms) {
                    Object.entries(data.platforms).forEach(([platform, info]) => {
                        updateProgressUI(platform, info);
                    });
                }

                if (data.status === 'completed') {
                    onUploadComplete(data);
                    return;
                }

                // Continue polling
                setTimeout(poll, 500);
            } catch (err) {
                setTimeout(poll, 1000);
            }
        };

        poll();
    }

    function updateProgressUI(platform, info) {
        const bar = $(`#bar-${platform}`);
        const percent = $(`#percent-${platform}`);
        const statusEl = $(`#status-item-${platform}`);

        if (!bar) return;

        bar.style.width = `${info.progress}%`;
        percent.textContent = `${info.progress}%`;

        statusEl.className = `progress-item-status ${info.status}`;
        switch (info.status) {
            case 'uploading':
                statusEl.textContent = 'Đang tải';
                break;
            case 'completed':
                statusEl.textContent = '✓ Xong';
                break;
            case 'failed':
                statusEl.textContent = '✗ Lỗi';
                break;
            default:
                statusEl.textContent = 'Đang chờ';
        }
    }

    function onUploadComplete(data) {
        state.isUploading = false;

        // Show results
        dom.resultsCard.style.display = 'block';
        dom.resultsCard.classList.add('fade-in');

        const results = Object.entries(data.platforms).map(([platform, info]) => {
            if (info.status === 'completed' && info.result) {
                return `
          <div class="result-item" style="animation-delay: ${Math.random() * 0.3}s">
            <span class="result-item-icon">✅</span>
            <div class="result-item-info">
              <div class="result-item-platform">${platformNames[platform]}</div>
              <a class="result-item-url" href="${info.result.url}" target="_blank">${info.result.url}</a>
            </div>
          </div>
        `;
            } else {
                return `
          <div class="result-item failed">
            <span class="result-item-icon">❌</span>
            <div class="result-item-info">
              <div class="result-item-platform">${platformNames[platform]}</div>
              <span style="font-size:0.8rem;color:var(--error-color)">${info.error || 'Upload thất bại'}</span>
            </div>
          </div>
        `;
            }
        });

        dom.resultsList.innerHTML = results.join('');

        // Update button
        dom.uploadBtn.querySelector('.btn-upload-content span').textContent = 'Đăng Video Ngay';
        updateUploadButton();

        showToast('🎉 Video đã được đăng thành công!', 'success');
    }

    // ---- New Upload ----
    function setupNewUploadButton() {
        dom.newUploadBtn.addEventListener('click', () => {
            clearFile();
            dom.videoTitle.value = '';
            dom.videoDescription.value = '';
            dom.videoTags.value = '';
            dom.titleCount.textContent = '0';
            dom.descCount.textContent = '0';
            dom.progressCard.style.display = 'none';
            dom.resultsCard.style.display = 'none';
            resetUploadState();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    function resetUploadState() {
        state.isUploading = false;
        state.currentUploadId = null;
        dom.uploadBtn.querySelector('.btn-upload-content span').textContent = 'Đăng Video Ngay';
        updateUploadButton();
    }

    // ---- API Calls ----
    async function fetchStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();

            if (data.platforms) {
                Object.entries(data.platforms).forEach(([platform, info]) => {
                    state.platformStatus[platform] = info.connected;
                    updatePlatformUI(platform, info.connected);
                });
            }
        } catch (e) {
            // Server might not be running, that's ok
        }
    }

    async function fetchAuthUrls() {
        try {
            const res = await fetch('/api/auth/urls');
            const data = await res.json();
            state.authUrls = data;
        } catch (e) {
            // Server might not be running
        }
    }

    // ---- URL Params (after OAuth redirect) ----
    function checkUrlParams() {
        const params = new URLSearchParams(window.location.search);

        if (params.get('connected')) {
            const platform = params.get('connected');
            state.platformStatus[platform] = true;
            updatePlatformUI(platform, true);
            showToast(`✅ ${platformNames[platform]} đã kết nối thành công!`, 'success');
            window.history.replaceState({}, '', '/');
        }

        if (params.get('error')) {
            const error = params.get('error');
            showToast(`❌ Lỗi kết nối: ${error}`, 'error');
            window.history.replaceState({}, '', '/');
        }
    }

    // ---- Connection Indicators ----
    function renderConnectionIndicators() {
        dom.connectionIndicators.innerHTML = ['youtube', 'facebook', 'tiktok'].map(p => `
      <div class="conn-dot ${state.platformStatus[p] ? 'connected' : 'disconnected'}" 
           data-platform="${p}" 
           title="${platformNames[p]}: ${state.platformStatus[p] ? 'Đã kết nối' : 'Chưa kết nối'}">
      </div>
    `).join('');
    }

    // ---- Toast ----
    function showToast(message, type = 'info') {
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

        dom.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastOut 300ms ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ---- Helpers ----
    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // ---- Start ----
    document.addEventListener('DOMContentLoaded', init);
})();
