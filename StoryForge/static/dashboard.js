// --- INITIALIZATION ---
let allCharacters = [];
let availableCharacters = [];
let currentProtagonist = null;
let currentHook = null; // Track selected hook for outline generation
let currentOutline = null;

let hookCount = 8;
let storyTemp = 1.2;
let storyFormat = "Light Novel";

async function init() {
    log("Initializing StoryForge...");
    try {
        const response = await fetch('/api/load_data');
        const data = await response.json();
        
        allCharacters = data.characters;
        availableCharacters = [...allCharacters];
        
        log(`System Ready: ${allCharacters.length} characters loaded.`);
    } catch (err) {
        log("Error loading data: " + err, "red");
        console.error(err);
    }
}

// --- CORE FUNCTIONS ---

async function fetchSuggestion() {
    if (availableCharacters.length === 0) {
        log("Resetting character list...", "yellow");
        availableCharacters = [...allCharacters];
    }
    log("Consulting Gemini for a protagonist...", "purple");
    toggleLoading(true);
    try {
        const response = await fetch('/api/suggest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characters: availableCharacters })
        });
        const result = await response.json();
        if (result.suggested_main_character) {
            currentProtagonist = result;
            updateSuggestionUI(result);
            log(`Gemini suggests: ${result.suggested_main_character}`);
        }
    } catch (err) {
        log("Suggestion failed: " + err, "red");
    } finally {
        toggleLoading(false);
    }
}

function rejectSuggestion() {
    if (!currentProtagonist) return;
    document.getElementById('suggestionBox').classList.add('hidden');
    availableCharacters = availableCharacters.filter(c => c.full_name !== currentProtagonist.suggested_main_character);
    fetchSuggestion();
}

async function acceptSuggestion() {
    if (!currentProtagonist) return;
    const fullCharData = allCharacters.find(c => c.full_name === currentProtagonist.suggested_main_character);

    // Read Settings
    const countInput = document.getElementById('settingHookCount');
    const tempInput = document.getElementById('settingTemp');
    hookCount = countInput ? parseInt(countInput.value) : 8;
    storyTemp = tempInput ? parseFloat(tempInput.value) : 1.2;

    log(`Generating ${hookCount} hooks for ${currentProtagonist.suggested_main_character}...`, "blue");
    toggleLoading(true);
    document.getElementById('suggestionBox').classList.add('hidden');

    try {
        const response = await fetch('/api/generate-hooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                character: fullCharData, 
                full_list: allCharacters,
                hook_count: hookCount,
                temperature: storyTemp
            })
        });
        const result = await response.json();
        renderHooks(result.hooks);
    } catch (err) {
        log("Hook generation failed: " + err, "red");
    } finally {
        toggleLoading(false);
    }
}

async function regenerateHooks() {
    if (!currentProtagonist) return;

    // 1. Get Settings
    const countInput = document.getElementById('settingHookCount');
    const tempInput = document.getElementById('settingTemp');
    hookCount = countInput ? parseInt(countInput.value) : 8;
    storyTemp = tempInput ? parseFloat(tempInput.value) : 1.2;

    log(`Regenerating ${hookCount} new hooks for ${currentProtagonist.suggested_main_character}...`, "blue");
    
    // 2. UI Feedback (Clear grid, show spinner)
    const grid = document.getElementById('hookGrid');
    const icon = document.getElementById('iconRegenHooks');
    
    if (icon) icon.classList.add('fa-spin');
    
    // Temporary loading state in the grid
    grid.innerHTML = `
        <div class="col-span-full w-full py-20 flex flex-col items-center justify-center text-gray-600 animate-pulse">
            <i class="fa-solid fa-pen-nib text-4xl mb-4"></i>
            <span class="text-xs uppercase tracking-widest">Drafting new concepts...</span>
        </div>
    `;

    try {
        // 3. Find full character data
        const fullCharData = allCharacters.find(c => c.full_name === currentProtagonist.suggested_main_character);

        // 4. Call API
        const response = await fetch('/api/generate-hooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                character: fullCharData, 
                full_list: allCharacters,
                hook_count: hookCount,
                temperature: storyTemp
            })
        });

        const result = await response.json();
        
        // 5. Render
        renderHooks(result.hooks);
        log("New batch of hooks generated.", "green");

    } catch (err) {
        log("Hook regeneration failed: " + err, "red");
        grid.innerHTML = `<div class="text-red-500">Error generating hooks. Check logs.</div>`;
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

// --- OUTLINE GENERATION ---

async function generateOutline(hook) {
    currentHook = hook;
    const fullCharData = allCharacters.find(c => c.full_name === currentProtagonist.suggested_main_character);
    
    const tempInput = document.getElementById('settingTemp');
    storyTemp = tempInput ? parseFloat(tempInput.value) : 1.2;
    const formatEl = document.querySelector('input[name="storyFormat"]:checked');
    storyFormat = formatEl ? formatEl.value : "Light Novel";

    // NEW: Get Chapter Counts
    const minChap = parseInt(document.getElementById('settingMinChap').value);
    const maxChap = parseInt(document.getElementById('settingMaxChap').value);

    log(`Developing outline for "${hook.title}" (${minChap}-${maxChap} chapters)...`, "purple");
    toggleLoading(true);

    document.getElementById('gridView').classList.add('hidden');

    try {
        const response = await fetch('/api/generate-outline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                hook: hook,
                protagonist: fullCharData,
                full_list: allCharacters,
                story_format: storyFormat,
                temperature: storyTemp,
                // NEW PARAMS
                min_chapters: minChap,
                max_chapters: maxChap
            })
        });

        const result = await response.json();
        currentOutline = result;
        updateOutlineUI(result);
        log("Outline generated successfully!", "green");

    } catch (err) {
        log("Outline generation failed: " + err, "red");
        document.getElementById('gridView').classList.remove('hidden');
    } finally {
        toggleLoading(false);
    }
}

function rejectOutline() {
    // Regenerate using the saved currentHook
    if (currentHook) {
        log("Regenerating outline...", "yellow");
        document.getElementById('outlineBox').classList.add('hidden');
        generateOutline(currentHook);
    }
}

function acceptOutline() {
    startWriting();
}

// --- UI RENDERERS ---

function updateSuggestionUI(data) {
    const box = document.getElementById('suggestionBox');
    const gridView = document.getElementById('gridView');
    const outlineBox = document.getElementById('outlineBox');
    
    gridView.classList.add('hidden');
    outlineBox.classList.add('hidden');
    box.classList.remove('hidden');
    box.classList.add('flex'); 

    document.getElementById('suggestedName').innerText = data.suggested_main_character;
    document.getElementById('suggestedReason').innerText = data.reason;
    document.getElementById('suggestedHook').innerText = data.sample_hook || "";

    const charData = allCharacters.find(c => c.full_name === data.suggested_main_character);
    if (charData) {
        document.getElementById('suggestedSpecies').innerText = charData.species || "UNKNOWN";
        document.getElementById('suggestedBio').innerText = charData.biography || "";
        document.getElementById('suggestedPersonality').innerText = charData.personality || "";
        
        const thumbStrip = document.getElementById('thumbStrip');
        thumbStrip.innerHTML = ''; 
        const imgData = charData.generated_images || {};
        const keys = Object.keys(imgData).sort(); 
        const mainImg = document.getElementById('suggestedImg');
        const placeholder = document.getElementById('imgPlaceholder');

        if (keys.length > 0) {
            const getPath = (k) => {
                const entry = imgData[k];
                const raw = (typeof entry === 'object' && entry !== null) ? entry.path : entry;
                return raw ? raw.replace(/\\/g, '/') : null;
            };
            const firstPath = getPath(keys[0]);
            if (firstPath) {
                mainImg.src = `/character_images/${firstPath}`;
                mainImg.classList.remove('opacity-0');
                placeholder.classList.add('hidden');
            }
            keys.forEach((key, idx) => {
                const path = getPath(key);
                if (!path) return;
                const imgUrl = `/character_images/${path}`;
                const thumb = document.createElement('img');
                thumb.src = imgUrl;
                thumb.className = `h-16 w-16 object-cover rounded border border-gray-700 cursor-pointer hover:border-white transition ${idx === 0 ? 'border-white opacity-100' : 'opacity-60'}`;
                thumb.onclick = () => {
                    mainImg.src = imgUrl;
                    Array.from(thumbStrip.children).forEach(t => {
                        t.classList.remove('border-white', 'opacity-100');
                        t.classList.add('border-gray-700', 'opacity-60');
                    });
                    thumb.classList.remove('border-gray-700', 'opacity-60');
                    thumb.classList.add('border-white', 'opacity-100');
                };
                thumbStrip.appendChild(thumb);
            });
        } else {
            mainImg.src = '';
            mainImg.classList.add('opacity-0');
            placeholder.classList.remove('hidden');
        }
    }
}

function updateOutlineUI(data) {
    const box = document.getElementById('outlineBox');
    box.classList.remove('hidden');
    box.classList.add('flex');

    document.getElementById('outlineTitle').innerText = data.title || "Untitled Story";
    
    const loglineHTML = `
        <span class="text-white">${data.logline || ""}</span>
        ${data.protagonist_arc ? `<br><span class="text-sm text-blue-400 mt-2 block"><strong class="text-blue-300">Arc:</strong> ${data.protagonist_arc}</span>` : ""}
    `;
    document.getElementById('outlineLogline').innerHTML = loglineHTML;
    document.getElementById('outlineOriginalHook').innerText = currentHook.idea;

    // --- RENDER SUBPLOTS (Updated for "focus") ---
    const subplots = data.subplots || [];
    const subplotHTML = subplots.map(sub => `
        <div class="mb-4 last:mb-0 bg-[#27272a] border border-[#3f3f46] p-4 rounded-lg">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-2 gap-2">
                <span class="text-xs font-bold text-purple-400 uppercase tracking-wider">${sub.title}</span>
                ${sub.focus ? `<span class="text-[9px] border border-purple-500/30 text-purple-200/70 px-2 py-0.5 rounded uppercase tracking-widest w-fit">${sub.focus}</span>` : ''}
            </div>
            
            <p class="text-gray-300 text-xs mb-3 leading-relaxed border-l-2 border-purple-900/50 pl-2">
                ${sub.description}
            </p>
            
            <div class="flex flex-wrap gap-1 mb-3">
                ${(sub.involved_character_names || []).map(n => 
                    `<span class="text-[9px] bg-black/50 text-gray-500 border border-gray-800 px-1.5 py-0.5 rounded">${n}</span>`
                ).join('')}
            </div>
            
            <div class="text-[10px] text-gray-500 italic bg-[#18181b] p-2 rounded border border-white/5">
                <strong class="text-emerald-600/80">Resolution:</strong> ${sub.resolution_arc}
            </div>
        </div>
    `).join('');

    const subplotContainer = document.getElementById('outlineSubplots');
    if (subplotContainer) subplotContainer.innerHTML = subplotHTML;

    // --- CAST RENDERING ---
    const castDiv = document.getElementById('outlineCast');
    let fullCastHTML = '';

    if (currentProtagonist && currentProtagonist.suggested_main_character) {
        fullCastHTML += createCastBadge(currentProtagonist.suggested_main_character, "Protagonist / Main Character", true);
    }

    const sideChars = data.selected_side_characters || {};
    if (Array.isArray(sideChars)) {
        fullCastHTML += sideChars.map(name => createCastBadge(name, "Side Character", false)).join('');
    } else {
        fullCastHTML += Object.entries(sideChars).map(([name, reason]) => 
            createCastBadge(name, reason, false)
        ).join('');
    }
    castDiv.innerHTML = fullCastHTML;

    // --- CHAPTERS ---
    const chaptersDiv = document.getElementById('outlineChapters');
    chaptersDiv.innerHTML = (data.outline || []).map(chap => `
        <div class="bg-[#18181b] border border-[#27272a] p-4 rounded-lg hover:border-emerald-500/30 transition">
            <div class="flex justify-between mb-2">
                <span class="text-emerald-500 text-[10px] font-bold uppercase tracking-widest">Chapter ${chap.chapter}</span>
                <span class="text-gray-500 text-[10px] uppercase tracking-widest font-bold">${chap.title || ""}</span>
            </div>
            <p class="text-gray-300 text-sm leading-relaxed">${chap.summary}</p>
        </div>
    `).join('');
}

function createCastBadge(name, role, isProtag = false) {
    const safeName = name.replace(/'/g, "\\'");
    const safeRole = role.replace(/'/g, "\\'");

    // STYLE LOGIC
    // Protagonist: Gold/Amber background and border
    // Cast: Dark Grey background, Purple hover
    const baseClasses = isProtag 
        ? "bg-amber-900/20 hover:bg-amber-900/40 border-amber-500/50 hover:border-amber-400 text-amber-100" 
        : "bg-[#27272a] hover:bg-purple-900/20 border-[#3f3f46] hover:border-purple-500 text-gray-300";

    const textHover = isProtag ? "group-hover:text-white" : "group-hover:text-purple-300";
    const iconColor = isProtag ? "text-amber-500" : "text-gray-600 group-hover:text-purple-400";
    
    return `
    <button onclick="openCharModal('${safeName}', '${safeRole}')" 
        class="group flex items-center gap-2 ${baseClasses} border px-3 py-1.5 rounded-full transition cursor-pointer">
        <span class="text-xs font-bold ${textHover}">${name}</span>
        <i class="fa-solid ${isProtag ? 'fa-star' : 'fa-circle-info'} text-[10px] ${iconColor}"></i>
    </button>
    `;
}

function backToHooks() {
    document.getElementById('outlineBox').classList.add('hidden');
    document.getElementById('gridView').classList.remove('hidden');
    // Optional: scroll back to top of grid
    document.getElementById('gridView').scrollIntoView({ behavior: 'smooth' });
}

function renderHooks(hooks) {
    const gridView = document.getElementById('gridView');
    const grid = document.getElementById('hookGrid');
    const header = document.getElementById('hooksHeader'); // New ID

    // Update Header Text
    if (currentProtagonist && currentProtagonist.suggested_main_character) {
        header.innerText = `Generated hooks for ${currentProtagonist.suggested_main_character}`;
    } else {
        header.innerText = "Generated Story Hooks";
    }

    grid.innerHTML = ''; 

    hooks.forEach(hook => {
        const card = document.createElement('div');
        card.className = "masonry-item bg-[#18181b] border border-[#27272a] p-6 rounded-xl hover:border-blue-500/50 transition-all shadow-lg hover:shadow-2xl hover:-translate-y-1 cursor-pointer group"; // Added group class
        
        card.onclick = () => generateOutline(hook);

        card.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <span class="bg-purple-600/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                    ${hook.tone}
                </span>
            </div>
            <h4 class="text-xl font-bold text-white mb-3 leading-tight group-hover:text-blue-300 transition">${hook.title}</h4>
            <p class="text-gray-300 text-sm leading-relaxed">${hook.idea}</p>
        `;
        grid.appendChild(card);
    });
    
    gridView.classList.remove('hidden');
    log(`${hooks.length} story hooks generated.`, "green");
    gridView.scrollIntoView({ behavior: 'smooth' });
}

function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.toggle('hidden');
}

function log(msg, color = "gray") {
    const logContent = document.getElementById('logContent');
    const colors = {
        red: "text-red-500",
        green: "text-green-500",
        blue: "text-blue-400",
        purple: "text-purple-400",
        yellow: "text-yellow-500",
        gray: "text-gray-500"
    };
    const div = document.createElement('div');
    div.className = colors[color] || "text-gray-300";
    div.innerHTML = `<span class="text-gray-600">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    logContent.prepend(div);
}

function toggleLoading(isLoading) {
    const btn = document.getElementById('btnSuggest');
    if (!btn) return;
    
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Consulting...`;
        btn.classList.add('opacity-50');
    } else {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-dice"></i> Suggest Protagonist`;
        btn.classList.remove('opacity-50');
    }
}

function toggleTerminal() {
    const panel = document.getElementById('terminalPanel');
    panel.classList.toggle('hidden');
}

// --- MODAL LOGIC ---

function openCharModal(name, role) {
    const char = allCharacters.find(c => c.full_name === name);
    if (!char) return; // Should not happen if data is consistent

    const modal = document.getElementById('charModal');
    const imgEl = document.getElementById('modalImg');
    const noImgEl = document.getElementById('modalNoImg');

    // Populate Text
    document.getElementById('modalName').innerText = char.full_name;
    document.getElementById('modalSpecies').innerText = char.species || "Unknown";
    document.getElementById('modalRole').innerText = role || "Selected Cast Member";
    document.getElementById('modalPersonality').innerText = char.personality || "No personality data.";
    document.getElementById('modalDesc').innerText = char.visual_description || char.biography || "";

    // Handle Image
    const imgData = char.generated_images || {};
    // Get the first available image key/path
    const firstKey = Object.keys(imgData)[0];
    
    if (firstKey) {
        let path = imgData[firstKey];
        if (typeof path === 'object') path = path.path;
        
        // Ensure path uses forward slashes
        path = path.replace(/\\/g, '/');
        
        // Set Source
        imgEl.src = `/character_images/${path}`;
        imgEl.classList.remove('hidden');
        noImgEl.classList.add('hidden');
    } else {
        imgEl.classList.add('hidden');
        noImgEl.classList.remove('hidden');
    }

    // Show Modal
    modal.classList.remove('hidden');
}

function closeCharModal() {
    document.getElementById('charModal').classList.add('hidden');
}

function validateChapterRange(changed) {
    const minEl = document.getElementById('settingMinChap');
    const maxEl = document.getElementById('settingMaxChap');
    const dispMin = document.getElementById('displayMinChap');
    const dispMax = document.getElementById('displayMaxChap');

    let min = parseInt(minEl.value);
    let max = parseInt(maxEl.value);

    if (changed === 'min') {
        if (min > max) {
            maxEl.value = min; 
            max = min;
        }
    } else {
        if (max < min) {
            minEl.value = max;
            min = max;
        }
    }

    dispMin.innerText = min;
    dispMax.innerText = max;
}

async function rescanData() {
    const icon = document.getElementById('iconRefresh');
    
    // UI Feedback: Spin the icon
    icon.classList.add('fa-spin');
    log("Rescanning character directories...", "yellow");

    try {
        // Reuse the existing load route which scans the disk
        const response = await fetch('/api/load_data');
        const data = await response.json();
        
        // Update global lists
        allCharacters = data.characters;
        
        // IMPORTANT: We reset availableCharacters to the full list
        // This effectively "un-rejects" everyone, giving you a fresh start
        availableCharacters = [...allCharacters];
        
        log(`Scan complete. Database updated: ${allCharacters.length} characters found.`, "green");
        
    } catch (err) {
        log("Rescan failed: " + err, "red");
    } finally {
        // Stop spinning
        setTimeout(() => icon.classList.remove('fa-spin'), 500);
    }
}

async function startWriting() {
    if (!currentOutline) return;

    const modal = document.getElementById('writingModal');
    const statusEl = document.getElementById('writingStatus');
    const barEl = document.getElementById('writingProgressBar');
    const completeMsg = document.getElementById('writingCompleteMsg');

    // Reset UI
    modal.classList.remove('hidden');
    completeMsg.classList.add('hidden');
    barEl.style.width = '0%';
    statusEl.innerText = "Initializing Engine...";

    try {
        const response = await fetch('/api/write-story', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outline: currentOutline })
        });

        // Setup Stream Reader
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            
            // The stream might send multiple JSON objects in one chunk separated by newlines
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    
                    if (data.status) statusEl.innerText = data.status;
                    if (data.progress) barEl.style.width = `${data.progress}%`;
                    
                    if (data.complete) {
                        statusEl.innerText = "Writing Complete!";
                        completeMsg.classList.remove('hidden');
                        log(`Story saved to: ${data.path}`, "green");
                    }
                } catch (e) {
                    console.error("Error parsing stream chunk", e);
                }
            }
        }

    } catch (err) {
        log("Writing Error: " + err, "red");
        statusEl.innerText = "Error: " + err;
    }
}

function closeWritingModal() {
    document.getElementById('writingModal').classList.add('hidden');
}

window.onclick = function(event) {
    const modal = document.getElementById('charModal');
    if (event.target === modal) {
        closeCharModal();
    }
}

init();