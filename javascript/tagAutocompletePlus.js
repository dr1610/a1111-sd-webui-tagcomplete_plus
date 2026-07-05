(() => {
    const state = {
        config: null,
        panel: null,
        hint: null,
        activeArea: null,
        activeRange: null,
        selectedIndex: -1,
        items: [],
        outsideClickAttached: false,
        globalShortcutAttached: false,
        configPromise: null,
        suppressNextAreaClick: false,
        history: [],
        historyIndex: -1,
    };

    const css = `
    .tacp-panel {
        position: absolute;
        z-index: 10000;
        min-width: 280px;
        max-width: min(720px, calc(100vw - 32px));
        max-height: 260px;
        overflow: auto;
        padding: 8px;
        border: 1px solid var(--block-border-color, #4b5563);
        border-radius: 6px;
        background: var(--body-background-fill, #111827);
        color: var(--body-text-color, #f3f4f6);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
        font: 13px/1.35 sans-serif;
    }
    .tacp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        color: var(--body-text-color-subdued, #9ca3af);
        font-size: 12px;
    }
    .tacp-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .tacp-controls {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
    }
    .tacp-nav,
    .tacp-close {
        cursor: pointer;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 1;
        padding: 2px 4px;
    }
    .tacp-nav:disabled {
        cursor: default;
        opacity: 0.35;
    }
    .tacp-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .tacp-item {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        cursor: pointer;
        border: 1px solid var(--button-secondary-border-color, #4b5563);
        border-radius: 5px;
        padding: 4px 7px;
        background: var(--button-secondary-background-fill, #1f2937);
        color: var(--button-secondary-text-color, #f9fafb);
        white-space: nowrap;
        text-align: left;
        line-height: 1.22;
    }
    .tacp-main {
        display: inline-flex;
        align-items: baseline;
    }
    .tacp-item:hover,
    .tacp-item.selected {
        background: var(--button-primary-background-fill, #2563eb);
        color: var(--button-primary-text-color, #ffffff);
    }
    .tacp-count {
        margin-left: 5px;
        opacity: 0.68;
        font-size: 11px;
    }
    .tacp-ja {
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        color: inherit;
        opacity: 0.72;
        font-size: 11px;
        font-weight: 400;
    }
    .tacp-hint {
        position: absolute;
        z-index: 9999;
        display: none;
        padding: 3px 7px;
        border: 1px solid var(--block-border-color, #4b5563);
        border-radius: 5px;
        background: rgba(17, 24, 39, 0.94);
        color: var(--body-text-color-subdued, #cbd5e1);
        font: 11px/1.25 sans-serif;
        pointer-events: none;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
    }`;

    function appRoot() {
        return typeof gradioApp === "function" ? gradioApp() : document;
    }

    async function fetchJson(url) {
        const separator = url.includes("?") ? "&" : "?";
        const response = await fetch(`${url}${separator}${Date.now()}`);
        if (!response.ok) {
            console.error(`Tag Autocomplete Plus: ${url} returned ${response.status}`);
            return null;
        }
        return response.json();
    }

    async function loadConfig() {
        if (state.configPromise) return state.configPromise;
        state.configPromise = (async () => {
            state.config = await fetchJson("tacplusapi/v1/config") || {
                enableRelatedTags: true,
                relatedMaxResults: 24,
                relatedTriggerMode: "Alt+R only",
            };
            state.configPromise = null;
            return state.config;
        })();
        return state.configPromise;
    }

    function ensureStyle() {
        if (document.getElementById("tacp-style")) return;
        const style = document.createElement("style");
        style.id = "tacp-style";
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensurePanel() {
        if (state.panel) return state.panel;
        const panel = document.createElement("div");
        panel.className = "tacp-panel";
        panel.style.display = "none";
        panel.innerHTML = `
            <div class="tacp-header">
                <span class="tacp-title"></span>
                <span class="tacp-controls">
                    <button class="tacp-nav tacp-back" type="button" title="Back">‹</button>
                    <button class="tacp-nav tacp-forward" type="button" title="Forward">›</button>
                    <button class="tacp-close" type="button" title="Close">×</button>
                </span>
            </div>
            <div class="tacp-list"></div>
        `;
        panel.querySelector(".tacp-back").addEventListener("click", () => navigateHistory(-1));
        panel.querySelector(".tacp-forward").addEventListener("click", () => navigateHistory(1));
        panel.querySelector(".tacp-close").addEventListener("click", hidePanel);
        document.body.appendChild(panel);
        state.panel = panel;
        return panel;
    }

    function ensureHint() {
        if (state.hint) return state.hint;
        const hint = document.createElement("div");
        hint.className = "tacp-hint";
        hint.textContent = "Alt+Rで関連タグ検索";
        document.body.appendChild(hint);
        state.hint = hint;
        return hint;
    }

    function panelIsVisible() {
        return state.panel && state.panel.style.display !== "none";
    }

    function attachOutsideClickHandler() {
        if (state.outsideClickAttached) return;
        state.outsideClickAttached = true;
        document.addEventListener("mousedown", (event) => {
            if (!panelIsVisible()) return;
            if (state.panel.contains(event.target)) return;
            hidePanel();
            state.suppressNextAreaClick = true;
            setTimeout(() => {
                state.suppressNextAreaClick = false;
            }, 0);
        }, true);
    }

    function textAreas() {
        if (typeof getTextAreas === "function") return getTextAreas();
        return [...appRoot().querySelectorAll("textarea, input[type='text']")];
    }

    function isPromptInput(element) {
        if (!element) return false;
        if (element.tagName === "TEXTAREA") return true;
        return element.tagName === "INPUT" && element.type === "text";
    }

    function clickTriggerEnabled() {
        return state.config?.relatedTriggerMode === "Alt+R or click";
    }

    function shortcutTrigger(event) {
        return (event.altKey && !event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "r") ||
            (event.ctrlKey && event.shiftKey && event.code === "Space");
    }

    function attachGlobalShortcutHandler() {
        if (state.globalShortcutAttached) return;
        state.globalShortcutAttached = true;
        document.addEventListener("keydown", async (event) => {
            if (!shortcutTrigger(event)) return;
            const area = event.target;
            if (!isPromptInput(area)) return;
            event.preventDefault();
            event.stopPropagation();
            ensureStyle();
            attachOutsideClickHandler();
            attach(area);
            if (!state.config) await loadConfig();
            showRelated(area);
        }, true);
    }

    function currentTagInfo(area) {
        const cursor = area.selectionStart ?? area.value.length;
        const text = area.value;
        let left = text.lastIndexOf(",", cursor - 1) + 1;
        let right = text.indexOf(",", cursor);
        if (right < 0) right = text.length;
        const raw = text.slice(left, right);
        const leading = raw.match(/^\s*/)?.[0].length || 0;
        const trailing = raw.match(/\s*$/)?.[0].length || 0;
        const start = left + leading;
        const end = right - trailing;
        const tag = text.slice(start, end)
            .replace(/[()[\]{}]/g, "")
            .replace(/:[0-9.]+/g, "")
            .trim();
        return { tag, start, end, insertAt: right };
    }

    function showHint(area) {
        if (!state.config?.enableRelatedTags || panelIsVisible()) return;
        const tagInfo = currentTagInfo(area);
        if (!tagInfo.tag) return hideHint();
        const hint = ensureHint();
        const rect = area.getBoundingClientRect();
        hint.style.top = `${window.scrollY + rect.bottom + 4}px`;
        hint.style.left = `${window.scrollX + rect.left + 8}px`;
        hint.style.display = "block";
    }

    function hideHint() {
        if (state.hint) state.hint.style.display = "none";
    }

    function visibleTag(tag) {
        if (window.TAC_CFG?.replaceUnderscores) {
            return tag.replaceAll("_", " ");
        }
        return tag;
    }

    function insertTag(area, tag) {
        const insert = visibleTag(tag);
        const range = area === state.activeArea ? state.activeRange : null;
        const start = range?.insertAt ?? area.selectionStart ?? area.value.length;
        const end = start;
        const before = area.value.slice(0, start);
        const after = area.value.slice(end);
        const prefix = before.length && !/[\s,(]$/.test(before) ? ", " : "";
        const suffix = after.length && !/^\s*,/.test(after) ? ", " : "";
        area.value = `${before}${prefix}${insert}${suffix}${after}`;
        const caret = before.length + prefix.length + insert.length + suffix.length;
        area.focus();
        area.setSelectionRange(caret, caret);
        area.dispatchEvent(new Event("input", { bubbles: true }));
        state.activeRange = {
            tag: insert,
            start: before.length + prefix.length,
            end: before.length + prefix.length + insert.length,
            insertAt: caret,
        };
    }

    function insertAndChain(area, tag) {
        insertTag(area, tag);
        showRelatedForTag(area, tag, { pushHistory: true });
    }

    function pushHistory(tag) {
        if (!tag) return;
        const current = state.history[state.historyIndex];
        if (current === tag) return;
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(tag);
        state.historyIndex = state.history.length - 1;
    }

    function updateHistoryButtons() {
        const panel = ensurePanel();
        const back = panel.querySelector(".tacp-back");
        const forward = panel.querySelector(".tacp-forward");
        back.disabled = state.historyIndex <= 0;
        forward.disabled = state.historyIndex < 0 || state.historyIndex >= state.history.length - 1;
    }

    function navigateHistory(delta) {
        if (!state.activeArea) return;
        const nextIndex = state.historyIndex + delta;
        if (nextIndex < 0 || nextIndex >= state.history.length) return;
        state.historyIndex = nextIndex;
        showRelatedForTag(state.activeArea, state.history[state.historyIndex], { pushHistory: false });
    }

    function visibleAutocompleteResults(area) {
        const areaRect = area.getBoundingClientRect();
        return [...appRoot().querySelectorAll(".autocompleteResults:not(.sideInfo)")]
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ element, rect }) => {
                const style = window.getComputedStyle(element);
                const horizontallyAligned = rect.right > areaRect.left && rect.left < areaRect.right;
                return style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    horizontallyAligned;
            })
            .sort((a, b) => b.rect.bottom - a.rect.bottom)[0] || null;
    }

    function positionPanel(area) {
        const panel = ensurePanel();
        const rect = area.getBoundingClientRect();
        const autocomplete = visibleAutocompleteResults(area);
        const bottom = autocomplete ? Math.max(rect.bottom, autocomplete.rect.bottom) : rect.bottom;
        const top = window.scrollY + bottom + 6;
        const left = Math.min(window.scrollX + rect.left, window.scrollX + document.documentElement.clientWidth - panel.offsetWidth - 16);
        panel.style.top = `${Math.max(8, top)}px`;
        panel.style.left = `${Math.max(8, left)}px`;
    }

    function emptyMessage(sourceTag, status) {
        if (status?.downloadRunning) {
            return `Downloading Danbooru CSV: ${sourceTag}`;
        }
        if (status?.downloadError) {
            return `Danbooru CSV download failed: ${status.downloadError}`;
        }
        if (status?.hasOnlyDemoCooccurrence) {
            return `Danbooru cooccurrence CSV not downloaded yet: ${sourceTag}`;
        }
        if (!status?.hasDanbooruCooccurrence && !status?.relationFiles?.length) {
            return `Danbooru cooccurrence CSV not ready: ${sourceTag}`;
        }
        return `No related tags: ${sourceTag}`;
    }

    function render(area, sourceTag, items, status = null) {
        const panel = ensurePanel();
        state.activeArea = area;
        state.items = items;
        state.selectedIndex = items.length ? 0 : -1;

        panel.querySelector(".tacp-title").textContent = items.length
            ? `${items[0]?.fallback ? "Broader matches" : "Related"}: ${sourceTag}`
            : emptyMessage(sourceTag, status);
        updateHistoryButtons();

        const list = panel.querySelector(".tacp-list");
        list.textContent = "";
        items.forEach((item, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `tacp-item${index === 0 ? " selected" : ""}`;
            const main = document.createElement("span");
            main.className = "tacp-main";

            const tag = document.createElement("span");
            tag.className = "tacp-tag";
            tag.textContent = visibleTag(item.tag);
            main.appendChild(tag);

            if (item.count) {
                const count = document.createElement("span");
                count.className = "tacp-count";
                count.textContent = item.count;
                main.appendChild(count);
            }

            button.appendChild(main);
            if (item.labelJa) {
                const label = document.createElement("span");
                label.className = "tacp-ja";
                label.textContent = item.labelJa;
                button.title = `${visibleTag(item.tag)}\n${item.labelJa}`;
                button.appendChild(label);
            }
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => insertAndChain(area, item.tag));
            list.appendChild(button);
        });

        panel.style.display = "block";
        hideHint();
        positionPanel(area);
    }

    async function showRelated(area) {
        if (!state.config?.enableRelatedTags) return;
        const tagInfo = currentTagInfo(area);
        const tag = tagInfo.tag;
        if (!tag) return hidePanel();
        state.activeArea = area;
        state.activeRange = tagInfo;
        state.history = [];
        state.historyIndex = -1;
        showRelatedForTag(area, tag, { pushHistory: true });
    }

    async function showRelatedForTag(area, tag, options = {}) {
        if (!state.config?.enableRelatedTags) return;
        if (options.pushHistory) {
            pushHistory(tag);
        }
        const limit = state.config.relatedMaxResults || 24;
        const data = await fetchJson(`tacplusapi/v1/related?tag=${encodeURIComponent(tag)}&limit=${limit}`);
        render(area, tag, data?.results || [], data?.status || state.config?.dataStatus || null);
    }

    function hidePanel() {
        if (state.panel) state.panel.style.display = "none";
        state.items = [];
        state.activeRange = null;
        state.selectedIndex = -1;
        state.history = [];
        state.historyIndex = -1;
    }

    function moveSelection(delta) {
        if (!state.items.length || !panelIsVisible()) return;
        state.selectedIndex = (state.selectedIndex + delta + state.items.length) % state.items.length;
        state.panel.querySelectorAll(".tacp-item").forEach((item, index) => {
            item.classList.toggle("selected", index === state.selectedIndex);
        });
    }

    function attach(area) {
        if (!area || area.dataset.tacpAttached) return;
        area.dataset.tacpAttached = "true";
        area.addEventListener("keydown", (event) => {
            if (shortcutTrigger(event)) {
                event.preventDefault();
                showRelated(area);
                return;
            }
            if (!panelIsVisible()) return;
            if (event.key === "Escape") {
                event.preventDefault();
                hidePanel();
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
            } else if (event.altKey && event.key === "ArrowLeft") {
                event.preventDefault();
                navigateHistory(-1);
            } else if (event.altKey && event.key === "ArrowRight") {
                event.preventDefault();
                navigateHistory(1);
            } else if ((event.key === "Enter" || event.key === "Tab") && state.selectedIndex >= 0) {
                event.preventDefault();
                insertAndChain(area, state.items[state.selectedIndex].tag);
            }
        });
        area.addEventListener("click", () => {
            if (state.suppressNextAreaClick) {
                state.suppressNextAreaClick = false;
                return;
            }
            if (clickTriggerEnabled()) {
                showRelated(area);
            } else {
                showHint(area);
            }
        });
        area.addEventListener("keyup", () => showHint(area));
        area.addEventListener("mouseup", () => showHint(area));
        area.addEventListener("focus", () => showHint(area));
        area.addEventListener("blur", () => setTimeout(hideHint, 120));
    }

    async function setup() {
        ensureStyle();
        attachOutsideClickHandler();
        attachGlobalShortcutHandler();
        if (!state.config) await loadConfig();
        textAreas().forEach(attach);
    }

    onUiUpdate(setup);
})();
