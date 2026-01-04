
/**
 * Travelog Application Logic
 * Pure REST Implementation
 */

// Initialize immediately
initApp();

async function initApp() {
    // --- state ---
    const state = {
        apiKey: localStorage.getItem('travelog_api_key') || '',
        images: [], // Array of { file, base64Url, mimeType }
        isGenerating: false,
        storyContent: '' // Store raw markdown here
    };

    // --- IndexedDB ---
    const db = {
        dbName: 'travelogDB',
        version: 1,
        storeName: 'stories',
        db: null,

        init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.version);
                request.onerror = (e) => {
                    console.error('IDB Error', e);
                    reject(e);
                };
                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: 'id' });
                    }
                };
            });
        },

        addStory(story) {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const store = tx.objectStore(this.storeName);
                const request = store.add(story);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e);
            });
        },

        getAllStories() {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readonly');
                const store = tx.objectStore(this.storeName);
                // Use 'prev' to get newest first (descending by key/id)
                const request = store.openCursor(null, 'prev');
                const results = [];
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        results.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                };
                request.onerror = (e) => reject(e);
            });
        },

        deleteStory(id) {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const store = tx.objectStore(this.storeName);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e);
            });
        },

        clearAll() {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const store = tx.objectStore(this.storeName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e);
            });
        }
    };

    // --- elements ---
    const els = {
        apiKeyModal: document.getElementById('apiKeyModal'),
        apiKeyInput: document.getElementById('apiKeyInput'),
        saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
        apiKeyError: document.getElementById('apiKeyError'),

        dropZone: document.getElementById('dropZone'),
        fileInput: document.getElementById('fileInput'),
        imagePreviewContainer: document.getElementById('imagePreviewContainer'),
        clearImagesBtn: document.getElementById('clearImagesBtn'),

        promptInput: document.getElementById('promptInput'),
        storyStyleInput: document.getElementById('storyStyleInput'),
        storyLengthSelect: document.getElementById('storyLengthSelect'),
        generateBtn: document.getElementById('generateBtn'),

        storyOutput: document.getElementById('storyOutput'),
        loadingOverlay: document.getElementById('loadingOverlay'),

        copyBtn: document.getElementById('copyBtn'),
        popOutBtn: document.getElementById('popOutBtn'), // New
        saveBtn: document.getElementById('saveBtn'),

        historyBtn: document.getElementById('historyBtn'),
        historyModal: document.getElementById('historyModal'),
        historyList: document.getElementById('historyList'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn')
    };

    // --- init ---
    if (!state.apiKey) {
        if (els.apiKeyModal) els.apiKeyModal.showModal();
    } else {
        if (els.apiKeyInput) els.apiKeyInput.value = state.apiKey;
    }

    try {
        await db.init();
        renderHistory();
    } catch (e) {
        console.error("Failed to init DB", e);
        showToast("Database error", 'error');
    }

    setupEventListeners();

    // --- event listeners ---
    function setupEventListeners() {
        if (!els.dropZone) return;

        // API Key
        els.saveApiKeyBtn.addEventListener('click', (e) => {
            const key = els.apiKeyInput.value.trim();
            if (key) {
                state.apiKey = key;
                localStorage.setItem('travelog_api_key', key);
                els.apiKeyError.classList.add('hidden');
            } else {
                e.preventDefault();
                els.apiKeyError.classList.remove('hidden');
            }
        });

        // Drag & Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            els.dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        els.dropZone.addEventListener('dragover', () => {
            els.dropZone.classList.add('border-primary', 'bg-base-200/60');
        });

        els.dropZone.addEventListener('dragleave', () => {
            els.dropZone.classList.remove('border-primary', 'bg-base-200/60');
        });

        els.dropZone.addEventListener('drop', handleDrop);

        els.dropZone.addEventListener('click', () => {
            if (state.images.length === 0) els.fileInput.click();
        });

        els.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
        els.clearImagesBtn.addEventListener('click', clearImages);
        els.generateBtn.addEventListener('click', generateStory);

        els.copyBtn.addEventListener('click', async () => {
            const textToCopy = state.storyContent || els.storyOutput.innerText;
            await navigator.clipboard.writeText(textToCopy);
            showToast('Story copied to clipboard!');
        });

        if (els.popOutBtn) {
            els.popOutBtn.addEventListener('click', popOutStory);
        }

        els.saveBtn.addEventListener('click', async () => {
            const story = state.storyContent;
            if (!story) return;

            // Prepare images for storage (exclude File objects)
            const savedImages = state.images.map(img => ({
                base64Url: img.base64Url,
                mimeType: img.mimeType
            }));

            const newStory = {
                id: Date.now(),
                date: new Date().toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                }),
                content: story, // Save raw markdown
                images: savedImages,
                prompt: els.promptInput.value || "Custom Story"
            };

            try {
                await db.addStory(newStory);
                renderHistory();
                showToast('Story and images saved to history!');
            } catch (e) {
                console.error("Save error", e);
                showToast('Failed to save. Storage might be full.', 'error');
            }
        });

        // History Actions
        if (els.historyBtn) {
            els.historyBtn.addEventListener('click', () => {
                renderHistory();
                els.historyModal.showModal();
            });
        }
        if (els.clearHistoryBtn) {
            els.clearHistoryBtn.addEventListener('click', () => {
                if (confirm('Clear all history?')) {
                    localStorage.removeItem('travelog_stories');
                    renderHistory();
                }
            });
        }
    }

    // --- Handlers ---

    function handleDrop(e) {
        els.dropZone.classList.remove('border-primary', 'bg-base-200/60');
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    function handleFiles(files) {
        if (!files.length) return;
        const newFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (newFiles.length === 0) {
            showToast('Please upload image files only.', 'error');
            return;
        }
        processFiles(newFiles);
    }

    async function processFiles(files) {
        for (const file of files) {
            try {
                const base64Url = await readFileAsBase64(file);
                state.images.push({
                    file,
                    base64Url,
                    mimeType: file.type
                });
            } catch (err) {
                console.error("Error reading file", err);
            }
        }
        updateImagePreviews();
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function updateImagePreviews() {
        els.imagePreviewContainer.innerHTML = '';
        if (state.images.length > 0) {
            els.imagePreviewContainer.classList.remove('hidden');
            els.clearImagesBtn.classList.remove('hidden');
        } else {
            els.imagePreviewContainer.classList.add('hidden');
            els.clearImagesBtn.classList.add('hidden');
        }

        state.images.forEach((img, idx) => {
            const div = document.createElement('div');
            div.className = 'w-full aspect-square relative group';
            const imgEl = document.createElement('img');
            imgEl.src = img.base64Url;
            imgEl.className = 'preview-img w-full h-full object-cover rounded-lg border border-base-content/10 shadow-sm';
            div.appendChild(imgEl);
            els.imagePreviewContainer.appendChild(div);
        });
    }

    function clearImages(e) {
        if (e) e.stopPropagation();
        state.images = [];
        els.fileInput.value = '';
        updateImagePreviews();
    }

    async function generateStory() {
        if (!state.apiKey) {
            els.apiKeyModal.showModal();
            return;
        }
        if (state.images.length === 0 && !els.promptInput.value.trim()) {
            showToast('Please add images or a prompt to start.', 'warning');
            return;
        }

        setLoading(true);
        els.storyOutput.innerHTML = ''; // Clear previous
        state.storyContent = '';

        try {
            await streamGenerateContentREST();
        } catch (error) {
            console.error('Generation Error:', error);
            showToast(`Error: ${error.message}`, 'error');
            els.storyOutput.innerHTML += `<div class="text-error mt-4 p-4 bg-error/10 rounded">Error: ${error.message}</div>`;
        } finally {
            setLoading(false);
        }
    }

    // PURE REST API IMPLEMENTATION
    async function streamGenerateContentREST() {
        const userValue = els.promptInput.value.trim();
        const styleValue = els.storyStyleInput.value.trim() || "Reflective introspection of the journey";
        const lengthValue = els.storyLengthSelect.value;

        let lengthInstruction = "Write a balanced story, around 500 words.";
        if (lengthValue === 'Short') lengthInstruction = "Keep the story concise, around 200-300 words.";
        else if (lengthValue === 'Long') lengthInstruction = "Write an extensive, detailed narrative, around 800-1000 words.";

        const styleInstruction = `You are a travel blogger. Write a captivating, personal blog post based on these images.
Style: ${styleValue}
Length: ${lengthInstruction}
Use a first-person narrative, focus on sensory details, emotions, and the atmosphere. Avoid encyclopedic descriptions or bullet points. Make it feel like a genuine travel experience.`;

        const finalPrompt = userValue
            ? `${styleInstruction}\n\nUser Context: ${userValue}`
            : styleInstruction;

        const parts = [{ text: finalPrompt }];
        state.images.forEach(img => {
            const base64Data = img.base64Url.split(',')[1];
            parts.push({
                inline_data: { mime_type: img.mimeType, data: base64Data }
            });
        });

        const models = [
            'gemini-3-flash-preview',
            'gemini-3-pro-preview'
        ];

        let lastError = null;
        for (const model of models) {
            try {
                els.storyOutput.innerHTML = `<span class="opacity-50 italic animate-pulse">[Connecting to model: ${model}...]</span>`;
                console.log(`Attempting REST generation with model: ${model}`);
                await tryStreamGenerateREST(model, parts);
                return;
            } catch (err) {
                console.warn(`REST Model ${model} failed:`, err);
                lastError = err;
                // Stop if key invalid
                if (err.message && err.message.includes('API key')) throw err;
            }
        }
        throw lastError || new Error('All models failed.');
    }

    async function tryStreamGenerateREST(model, parts) {
        // v1beta is generally more stable for streaming than v1alpha for raw REST unless specified
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${state.apiKey}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: parts }]
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMsg = `Model ${model} error ${response.status}`;
                try {
                    const errData = await response.json();
                    if (errData.error) errorMsg = errData.error.message;
                } catch { }
                throw new Error(errorMsg);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = '';
            let textStarted = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Stream Parser: Find complete JSON objects using brace counting
                let cursor = 0;
                let openBraces = 0;
                let inString = false;
                let escaped = false;
                let start = -1;

                while (cursor < buffer.length) {
                    const char = buffer[cursor];

                    if (inString) {
                        if (char === '\\') {
                            escaped = !escaped;
                        } else if (char === '"' && !escaped) {
                            inString = false;
                        } else {
                            escaped = false;
                        }
                    } else {
                        if (char === '"') {
                            inString = true;
                        } else if (char === '{') {
                            if (openBraces === 0) start = cursor;
                            openBraces++;
                        } else if (char === '}') {
                            openBraces--;
                            if (openBraces === 0 && start !== -1) {
                                // Full object found
                                const jsonStr = buffer.substring(start, cursor + 1);
                                try {
                                    const json = JSON.parse(jsonStr);
                                    if (json.candidates && json.candidates[0]?.content?.parts) {
                                        const text = json.candidates[0].content.parts.map(p => p.text).join('');

                                        // Clear status message on first token
                                        if (!textStarted) {
                                            els.storyOutput.innerHTML = '';
                                            textStarted = true;
                                        }

                                        state.storyContent += text;
                                        // Real-time Markdown Rendering
                                        // Note: marked.parse returns a promise if async, but default is sync string.
                                        // We assume synchronous marked here.
                                        els.storyOutput.innerHTML = marked.parse(state.storyContent);

                                        els.storyOutput.scrollTop = els.storyOutput.scrollHeight;
                                    }
                                } catch (e) {
                                    console.warn("Parse error for chunk", e);
                                }

                                // Advance buffer past this object
                                buffer = buffer.substring(cursor + 1);
                                cursor = -1; // Reset loop for new buffer
                                start = -1;
                                openBraces = 0;
                                inString = false;
                                escaped = false;
                            }
                        }
                    }
                    cursor++;
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error(`Timeout: Model ${model} took too long.`);
            throw error;
        }
    }

    function setLoading(isLoading) {
        state.isGenerating = isLoading;
        if (isLoading) {
            els.loadingOverlay.classList.remove('hidden');
            els.generateBtn.setAttribute('disabled', 'true');
        } else {
            els.loadingOverlay.classList.add('hidden');
            els.generateBtn.removeAttribute('disabled');
        }
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-top toast-center z-50`;
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} shadow-lg`;
        alert.innerHTML = `<span>${message}</span>`;
        toast.appendChild(alert);
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    if (els.clearHistoryBtn) {
        els.clearHistoryBtn.addEventListener('click', async () => {
            if (confirm('Clear all history?')) {
                await db.clearAll();
                renderHistory();
            }
        });
    }

    async function renderHistory() {
        const history = await db.getAllStories();
        els.historyList.innerHTML = '';

        if (history.length === 0) {
            els.historyList.innerHTML = `
                <div class="text-center py-10 opacity-50 flex flex-col items-center gap-2">
                    <ion-icon name="book-outline" class="text-4xl"></ion-icon>
                    <p>No stories saved yet.</p>
                </div>`;
            return;
        }

        history.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card bg-base-100 border border-base-content/10 shadow-sm hover:shadow-md transition-all duration-300';
            card.innerHTML = `
                <div class="card-body p-5">
                    <div class="flex justify-between items-start mb-2">
                        <span class="badge badge-primary badge-outline text-xs">${item.date}</span>
                        <div class="flex gap-2">
                            ${item.images && item.images.length > 0 ?
                    `<span class="badge badge-secondary badge-outline text-xs gap-1">
                                    <ion-icon name="image"></ion-icon> ${item.images.length}
                                 </span>` : ''}
                            <button class="btn btn-ghost btn-xs btn-circle text-error delete-btn">
                                <ion-icon name="trash"></ion-icon>
                            </button>
                        </div>
                    </div>
                    <p class="text-sm opacity-70 italic mb-3 line-clamp-2">"${item.prompt}"</p>
                    <div class="text-base font-serif leading-relaxed line-clamp-4 relative">
                        ${item.content}
                        <div class="absolute bottom-0 w-full h-8 bg-gradient-to-t from-base-100 to-transparent"></div>
                    </div>
                    <div class="card-actions justify-end mt-4">
                        <button class="btn btn-sm btn-outline btn-primary view-btn">Read Full</button>
                    </div>
                </div>
            `;

            // Delete Action
            card.querySelector('.delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Delete this entry?')) {
                    await db.deleteStory(item.id);
                    renderHistory();
                }
            });

            // View/Load Action
            card.querySelector('.view-btn').addEventListener('click', () => {
                state.storyContent = item.content; // Load into state
                els.storyOutput.innerHTML = marked.parse(item.content);
                els.promptInput.value = item.prompt;

                // Restore Images
                state.images = (item.images || []).map(img => ({
                    base64Url: img.base64Url,
                    mimeType: img.mimeType,
                    file: null // Original file object is lost, not needed for display/re-gen
                }));
                updateImagePreviews();

                els.historyModal.close();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            els.historyList.appendChild(card);
        });
    }

    function popOutStory() {
        const story = state.storyContent;
        if (!story) {
            showToast('No story to pop out!', 'warning');
            return;
        }

        const win = window.open('', '_blank');
        if (!win) {
            showToast('Popup blocked!', 'error');
            return;
        }

        const imagesHtml = state.images.map(img => `
            <div class="mb-8">
                <img src="${img.base64Url}" class="w-full h-auto rounded-lg shadow-lg border border-base-300" alt="Travel Photo">
            </div>
        `).join('');

        const html = `
            <!DOCTYPE html>
            <html lang="en" data-theme="sunset">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Travelog Story</title>
                <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.23/dist/full.min.css" rel="stylesheet" type="text/css" />
                <script src="https://cdn.tailwindcss.com"></script>
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                <style>
                    body { font-family: 'Times New Roman', serif; background-color: #0d0d0d; color: #e0e0e0; }
                    .prose { max-width: 65ch; margin: 0 auto; line-height: 1.8; font-size: 1.25rem; }
                    .prose h1 { font-size: 2.5em; font-weight: bold; margin-bottom: 0.5em; color: #fff; text-align: center; }
                    .prose h2 { font-size: 1.8em; margin-top: 1.5em; margin-bottom: 0.5em; color: #f0f0f0; }
                    .prose p { margin-bottom: 1.5em; }
                    .prose strong { color: #ffab91; }
                </style>
            </head>
            <body class="min-h-screen p-8 md:p-16 bg-base-100">
                <div class="max-w-3xl mx-auto">
                    <!-- Story Content -->
                    <article class="prose mb-16">
                        ${marked.parse(story)}
                    </article>

                    <div class="divider opacity-20 my-12"></div>

                    <!-- Images -->
                    <div class="space-y-12">
                         ${imagesHtml}
                    </div>

                    <div class="text-center mt-16 opacity-50 text-sm font-sans">
                        Generated by Travelog
                    </div>
                </div>
            </body>
            </html>
        `;

        win.document.write(html);
        win.document.close();
    }
}
