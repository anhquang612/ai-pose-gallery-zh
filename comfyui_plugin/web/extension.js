import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const LIBRARIES = {
  pose: {
    key: "pose",
    label: "Poses (1,439)",
    shortLabel: "Pose",
    defaultId: "full_single_P001_front",
    titleField: "姿势名称",
    primaryField: "分类",
    secondaryField: "角度",
    primaryPlaceholder: "All pose categories",
    secondaryPlaceholder: "All angles",
  },
  costume: {
    key: "costume",
    label: "Costumes (3,224)",
    shortLabel: "Costume",
    defaultId: "SPR-0001",
    titleField: "服装名称",
    primaryField: "一级分类",
    secondaryField: "分类",
    primaryPlaceholder: "All · Realistic / Anime",
    secondaryPlaceholder: "All costume categories",
  },
  portrait: {
    key: "portrait",
    label: "Portraits (1,499)",
    shortLabel: "Portrait",
    defaultId: "f71f980dde3",
    titleField: "发型名称",
    primaryField: "发长",
    secondaryField: "分区",
    primaryPlaceholder: "All hair lengths",
    secondaryPlaceholder: "All sections",
  },
};

// --- English localization layer (local addition) ---
let I18N = {};
async function loadI18n() {
  if (Object.keys(I18N).length) return;
  try {
    const resp = await api.fetchApi("/pose_character_atlas/i18n");
    if (resp.ok) I18N = await resp.json();
  } catch (e) {
    console.warn("[PoseAtlas] i18n load failed", e);
  }
}
function t(text) {
  if (!text) return text;
  if (I18N[text]) return I18N[text];
  const i = text.indexOf("・");
  if (i > 0 && I18N[text.slice(0, i)]) return `${I18N[text.slice(0, i)]} · ${t(text.slice(i + 1))}`;
  return text;
}

const NODE_LIB_MAP = {
  PoseGalleryNode: "pose",
  CostumeGalleryNode: "costume",
  PortraitGalleryNode: "portrait",
  CharacterRecipeNode: "recipe",
};

const catalogueCache = {};
const PAGE_SIZE = 60;

function injectStylesheet() {
  if (document.getElementById("pca-comfy-styles")) return;
  const link = document.createElement("link");
  link.id = "pca-comfy-styles";
  link.rel = "stylesheet";
  link.href = new URL("./style.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function fetchCatalogue(lib) {
  if (catalogueCache[lib]) return catalogueCache[lib];
  const resp = await api.fetchApi(
    `/pose_character_atlas/catalogue?library=${encodeURIComponent(lib)}`
  );
  if (!resp.ok) {
    throw new Error(`Failed to load ${lib} library: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  catalogueCache[lib] = (data.items || []).map((item) => lib === "costume" ? { ...item, 一级分类: item["一级分类"] || "现实" } : item);
  return catalogueCache[lib];
}

function getThumbUrl(lib, id, relPath, useDepth = false) {
  if (!relPath && lib === "costume") relPath = catalogueCache.costume?.find((r) => r.id === id)?.缩略图;
  if (lib === "costume" && /^charadb-O\d{3}$/.test(id)) return `https://charadb-2fi.pages.dev/thumb/${id.slice(8)}.webp`;
  if (lib === "costume" && relPath?.startsWith("https://ai-costume-anime-gallery.pages.dev/")) return relPath;
  const depthParam = lib === "pose" && useDepth ? "&depth=1" : "";
  if (relPath) {
    return `/pose_character_atlas/image?path=${encodeURIComponent(relPath)}${depthParam}`;
  }
  return `/pose_character_atlas/image?library=${encodeURIComponent(lib)}&id=${encodeURIComponent(id)}&kind=thumb${depthParam}`;
}

function getItemTitle(lib, item) {
  // Costume names are long free-text Chinese; use the English keyword field instead.
  if (lib === "costume" && item["关键词"]) {
    const kw = item["关键词"];
    return kw.length > 90 ? kw.slice(0, 87) + "..." : kw;
  }
  const cfg = LIBRARIES[lib];
  return t(
    item[cfg.titleField] ||
    item["标题"] ||
    item["姿势名称"] ||
    item["服装名称"] ||
    item["发型名称"] ||
    item.id
  );
}

function findWidget(node, name) {
  return (node.widgets || []).find((w) => w.name === name);
}

function setWidgetValue(node, name, value) {
  const w = findWidget(node, name);
  if (!w) return;
  w.value = value;
  if (typeof w.callback === "function") {
    w.callback(value);
  }
  app.graph.setDirtyCanvas(true, true);
}

const NSFW_POSE_SYSTEMS = new Set(["全身单人・性感系", "双人缠绵"]);
const NSFW_COSTUME_CATEGORIES = new Set(["内衣・睡衣", "性感穿搭"]);

function isItemNsfw(lib, item) {
  if (lib === "pose") return NSFW_POSE_SYSTEMS.has(item["体系"]);
  if (lib === "costume") return Boolean(item["敏感"]) || NSFW_COSTUME_CATEGORIES.has(item["分类"]);
  return false;
}

class PoseAtlasModal {
  constructor() {
    this.backdrop = null;
    this.activeLib = "pose";
    this.targetNode = null;
    this.mode = "single"; // "single" | "recipe"
    this.safeMode = false; // local: NSFW unlocked by default
    this.useDepth = false;
    this.searchQuery = "";
    this.primaryFilter = "";
    this.secondaryFilter = "";
    this.sourceFilter = "";
    this.page = 1;
    this.costumeView = "front";
    this.recipeSelection = {
      portrait: LIBRARIES.portrait.defaultId,
      costume: LIBRARIES.costume.defaultId,
      pose: LIBRARIES.pose.defaultId,
    };
  }

  async open({ node = null, initialLib = "pose", mode = "single" } = {}) {
    injectStylesheet();
    await loadI18n();
    this.targetNode = node;
    this.mode = mode;
    this.activeLib = initialLib;
    this.page = 1;

    if (node) {
      this.costumeView = findWidget(node, "costume_view")?.value || "front";
      this.useDepth = Boolean(findWidget(node, "use_depth")?.value);
      if (mode === "recipe") {
        this.recipeSelection.portrait =
          findWidget(node, "portrait_id")?.value ||
          LIBRARIES.portrait.defaultId;
        this.recipeSelection.costume =
          findWidget(node, "costume_id")?.value || LIBRARIES.costume.defaultId;
        this.recipeSelection.pose =
          findWidget(node, "pose_id")?.value || LIBRARIES.pose.defaultId;
      } else {
        const currentId =
          findWidget(node, "image_id")?.value ||
          LIBRARIES[initialLib].defaultId;
        this.recipeSelection[initialLib] = currentId;
      }
    }

    this.renderShell();
    await this.switchLibrary(this.activeLib);
  }

  close() {
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
  }

  renderShell() {
    this.close();
    const backdrop = document.createElement("div");
    backdrop.className = "pca-modal-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this.close();
    });

    backdrop.innerHTML = `
      <div class="pca-modal">
        <div class="pca-header">
          <div class="pca-title-group">
            <div>
              <h3 class="pca-title">AI Character Reference Library (ComfyUI Picker)</h3>
              <div class="pca-subtitle">6,162 references · Shisei / wquguru CC0 · anime costumes load online · <a href="https://github.com/taki-ttt/charadb/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">CharaDB terms</a></div>
            </div>
          </div>
          <div class="pca-tabs" id="pca-tabs"></div>
          <button class="pca-btn" id="pca-close-btn">Close ✕</button>
        </div>
        <div class="pca-toolbar">
          <input class="pca-search-input" id="pca-search" type="text" placeholder="Search English or Chinese: title, pose, outfit, hairstyle, ID (e.g. sitting / sailor / bob / SPR-0001)..." />
          <select class="pca-select" id="pca-filter-primary"></select>
          <select class="pca-select" id="pca-filter-secondary"></select>
          <select class="pca-select" aria-label="Costume source" id="pca-filter-source"><option value="">All sources</option><option value="gia">Gia · Realistic</option><option value="gia-anime">Gia · Anime</option><option value="charadb">CharaDB (anime)</option><option value="shisei">Shisei · Chinese historical</option></select>
          <button class="pca-btn" id="pca-depth-btn">${this.useDepth ? "🌗 Depth map" : "🗿 Mannequin"}</button>
          <button class="pca-btn" id="pca-sfw-btn">${this.safeMode ? "🛡️ Safe mode (SFW)" : "🔞 18+ full mode"}</button>
          <button class="pca-btn" id="pca-random-btn">🎲 Random</button>
          <button class="pca-btn" id="pca-reset-btn">Reset filters</button>
        </div>
        <div class="pca-grid-wrap">
          <div class="pca-grid" id="pca-grid"></div>
        </div>
        <div class="pca-footer">
          <div class="pca-recipe-slots" id="pca-recipe-slots"></div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="pca-btn" id="pca-prev-page">Prev</button>
            <span id="pca-page-info" style="font-size:12px;color:#9ca3af;">1 / 1</span>
            <button class="pca-btn" id="pca-next-page">Next</button>
            <button class="pca-btn pca-btn-primary" id="pca-apply-btn">Apply to node</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.backdrop = backdrop;

    backdrop
      .querySelector("#pca-close-btn")
      .addEventListener("click", () => this.close());

    const searchInput = backdrop.querySelector("#pca-search");
    searchInput.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.page = 1;
      this.renderGrid();
    });

    backdrop
      .querySelector("#pca-filter-primary")
      .addEventListener("change", (e) => {
        this.primaryFilter = e.target.value;
        this.secondaryFilter = "";
        this.populateFilters();
        this.page = 1;
        this.renderGrid();
      });

    backdrop
      .querySelector("#pca-filter-secondary")
      .addEventListener("change", (e) => {
        this.secondaryFilter = e.target.value;
        this.page = 1;
        this.renderGrid();
      });

    backdrop.querySelector("#pca-filter-source").addEventListener("change", (e) => {
      this.sourceFilter = e.target.value;
      this.page = 1;
      this.renderGrid();
    });
    const depthBtn = backdrop.querySelector("#pca-depth-btn");
    depthBtn.addEventListener("click", () => {
      this.useDepth = !this.useDepth;
      depthBtn.textContent = this.useDepth ? "🌗 Depth map" : "🗿 Mannequin";
      if (this.targetNode) {
        setWidgetValue(this.targetNode, "costume_view", this.costumeView);
      setWidgetValue(this.targetNode, "use_depth", this.useDepth);
      }
      this.renderGrid();
      this.renderFooterSlots();
    });

    const sfwBtn = backdrop.querySelector("#pca-sfw-btn");
    sfwBtn.addEventListener("click", () => {
      if (this.safeMode) {
        this.safeMode = false;
      } else {
        this.safeMode = true;
      }
      sfwBtn.textContent = this.safeMode ? "🛡️ Safe mode (SFW)" : "🔞 18+ full mode";
      this.page = 1;
      this.populateFilters();
      this.renderGrid();
    });

    backdrop
      .querySelector("#pca-random-btn")
      .addEventListener("click", () => this.pickRandom());

    backdrop.querySelector("#pca-reset-btn").addEventListener("click", () => {
      this.searchQuery = "";
      this.primaryFilter = "";
      this.secondaryFilter = "";
      this.sourceFilter = "";
      backdrop.querySelector("#pca-filter-source").value = "";
      searchInput.value = "";
      this.page = 1;
      this.populateFilters();
      this.renderGrid();
    });

    backdrop.querySelector("#pca-prev-page").addEventListener("click", () => {
      if (this.page > 1) {
        this.page--;
        this.renderGrid();
      }
    });

    backdrop.querySelector("#pca-next-page").addEventListener("click", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(this.getFilteredItems().length / PAGE_SIZE)
      );
      if (this.page < totalPages) {
        this.page++;
        this.renderGrid();
      }
    });

    backdrop
      .querySelector("#pca-apply-btn")
      .addEventListener("click", () => this.applyAndClose());
  }

  renderTabs() {
    const tabsEl = this.backdrop.querySelector("#pca-tabs");
    tabsEl.innerHTML = "";
    Object.values(LIBRARIES).forEach((libCfg) => {
      const btn = document.createElement("button");
      btn.className = `pca-tab-btn ${this.activeLib === libCfg.key ? "active" : ""}`;
      btn.textContent = libCfg.label;
      btn.addEventListener("click", () => this.switchLibrary(libCfg.key));
      tabsEl.appendChild(btn);
    });
  }

  async switchLibrary(lib) {
    this.activeLib = lib;
    this.backdrop.querySelector("#pca-filter-source").style.display = lib === "costume" ? "" : "none";
    this.primaryFilter = "";
    this.secondaryFilter = "";
    this.page = 1;
    this.renderTabs();

    const gridEl = this.backdrop.querySelector("#pca-grid");
    gridEl.innerHTML = `<div style="padding:40px;color:#9ca3af;">Loading ${LIBRARIES[lib].label}...</div>`;

    await fetchCatalogue(lib);
    this.populateFilters();
    this.renderGrid();
    this.renderFooterSlots();
  }

  populateFilters() {
    const rawItems = catalogueCache[this.activeLib] || [];
    const items = this.safeMode
      ? rawItems.filter((it) => !isItemNsfw(this.activeLib, it))
      : rawItems;
    const cfg = LIBRARIES[this.activeLib];

    const primarySet = new Set();
    const secondarySet = new Set();
    items.forEach((it) => {
      if (cfg.primaryField && it[cfg.primaryField]) {
        primarySet.add(it[cfg.primaryField]);
      }
      if (cfg.secondaryField && it[cfg.secondaryField] && (!this.primaryFilter || it[cfg.primaryField] === this.primaryFilter)) {
        secondarySet.add(it[cfg.secondaryField]);
      }
    });

    const pSelect = this.backdrop.querySelector("#pca-filter-primary");
    pSelect.innerHTML = `<option value="">${cfg.primaryPlaceholder}</option>`;
    Array.from(primarySet).forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = t(val);
      pSelect.appendChild(opt);
    });
    pSelect.value = this.primaryFilter;

    const sSelect = this.backdrop.querySelector("#pca-filter-secondary");
    if (!cfg.secondaryField) {
      sSelect.style.display = "none";
    } else {
      sSelect.style.display = "";
      sSelect.innerHTML = `<option value="">${cfg.secondaryPlaceholder}</option>`;
      Array.from(secondarySet).forEach((val) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = t(val);
        sSelect.appendChild(opt);
      });
      sSelect.value = this.secondaryFilter;
    }
  }

  getFilteredItems() {
    const rawItems = catalogueCache[this.activeLib] || [];
    const items = this.safeMode
      ? rawItems.filter((it) => !isItemNsfw(this.activeLib, it))
      : rawItems;
    const cfg = LIBRARIES[this.activeLib];
    const q = this.searchQuery;

    return items.filter((it) => {
      if (this.activeLib === "costume" && this.sourceFilter && (it.source || "gia") !== this.sourceFilter) return false;
      if (
        this.primaryFilter &&
        cfg.primaryField &&
        it[cfg.primaryField] !== this.primaryFilter
      ) {
        return false;
      }
      if (
        this.secondaryFilter &&
        cfg.secondaryField &&
        it[cfg.secondaryField] !== this.secondaryFilter
      ) {
        return false;
      }
      if (q) {
        const title = getItemTitle(this.activeLib, it);
        const enTags = (it["标签"] || []).map(t).join(" ");
        const hay =
          `${it.id || ""} ${title} ${it["检索"] || ""} ${it["分类"] || ""} ${t(it["分类"] || "")} ${t(it["体系"] || "")} ${t(it["角度"] || "")} ${t(it["发长"] || "")} ${t(it["发型名称"] || "")} ${t(it["姿势名称"] || "")} ${enTags}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }

  renderGrid() {
    const filtered = this.getFilteredItems();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (this.page > totalPages) this.page = totalPages;

    const start = (this.page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    const pageInfo = this.backdrop.querySelector("#pca-page-info");
    pageInfo.textContent = `Page ${this.page} / ${totalPages} (${filtered.length} items)`;

    const gridEl = this.backdrop.querySelector("#pca-grid");
    gridEl.innerHTML = "";

    const selectedId = this.recipeSelection[this.activeLib];
    const cfg = LIBRARIES[this.activeLib];

    slice.forEach((original) => {
      const chosenView = original.views?.find((v) => v.id === this.costumeView) || original.views?.[0];
      const item = chosenView ? { ...original, ...chosenView, id: original.id } : original;
      const card = document.createElement("div");
      card.className = `pca-card ${item.id === selectedId ? "selected" : ""}`;
      const title = getItemTitle(this.activeLib, item);
      const badge = t(
        (cfg.secondaryField && item[cfg.secondaryField]) ||
        item[cfg.primaryField] ||
        ""
      );
      const subText =
        t(item[cfg.primaryField] || "") +
        (cfg.secondaryField && item[cfg.secondaryField]
          ? ` · ${t(item[cfg.secondaryField])}`
          : "") + (item.source === "charadb" ? " · Taki AI / CharaDB" : "");

      card.innerHTML = `
        <div class="pca-card-img-wrap">
          <img class="pca-card-img" loading="lazy" src="${getThumbUrl(this.activeLib, item.id, item["缩略图"], this.useDepth)}" alt="${title}" />
          <span class="pca-card-id">#${item.id}</span>
          ${badge ? `<span class="pca-card-badge">${badge}</span>` : ""}
        </div>
        <div class="pca-card-meta">
          <div class="pca-card-title" title="${title}">${title}</div>
          <div class="pca-card-sub">${subText}</div>
        </div>
      `;

      if (original.views?.length) {
        const select = document.createElement("select");
        select.className = "pca-select";
        select.setAttribute("aria-label", "Costume view");
        original.views.forEach((view) => {
          const option = document.createElement("option");
          option.value = view.id; option.textContent = t(view.label);
          select.appendChild(option);
        });
        select.value = chosenView.id;
        select.addEventListener("click", (e) => e.stopPropagation());
        select.addEventListener("change", () => { this.costumeView = select.value; this.recipeSelection.costume = item.id; this.renderGrid(); this.renderFooterSlots(); });
        card.appendChild(select);
      }
      card.addEventListener("click", () => {
        this.recipeSelection[this.activeLib] = item.id;
        if (this.activeLib === "costume") this.costumeView = chosenView?.id || "front";
        if (this.mode === "single") {
          this.applyAndClose();
        } else {
          this.renderGrid();
          this.renderFooterSlots();
        }
      });

      gridEl.appendChild(card);
    });
  }

  renderFooterSlots() {
    const slotsEl = this.backdrop.querySelector("#pca-recipe-slots");
    slotsEl.innerHTML = "";
    ["portrait", "costume", "pose"].forEach((libKey) => {
      const id = this.recipeSelection[libKey];
      const row = catalogueCache[libKey]?.find((r) => r.id === id);
      const view = row?.views?.find((v) => v.id === this.costumeView) || row?.views?.[0];
      const pill = document.createElement("div");
      pill.className = `pca-slot-pill ${this.activeLib === libKey ? "active" : ""}`;
      pill.innerHTML = `
        <img src="${getThumbUrl(libKey, id, view?.缩略图 || row?.缩略图, this.useDepth)}" alt="${id}" />
        <div>
          <div style="font-weight:600;color:#fff;">${LIBRARIES[libKey].shortLabel}</div>
          <div style="color:#9ca3af;font-family:monospace;">#${id}</div>
        </div>
      `;
      pill.addEventListener("click", () => this.switchLibrary(libKey));
      slotsEl.appendChild(pill);
    });
  }

  pickRandom() {
    const filtered = this.getFilteredItems().filter((item) => item.source !== "charadb");
    if (!filtered.length) return;
    const rand = filtered[Math.floor(Math.random() * filtered.length)];
    this.recipeSelection[this.activeLib] = rand.id;
    if (this.activeLib === "costume") this.costumeView = rand.views?.find((v) => v.id === "front")?.id || rand.views?.[0]?.id || "front";
    this.renderGrid();
    this.renderFooterSlots();
    if (this.mode === "single") {
      this.applyAndClose();
    }
  }

  applyAndClose() {
    if (this.targetNode) {
      setWidgetValue(this.targetNode, "costume_view", this.costumeView);
      setWidgetValue(this.targetNode, "use_depth", this.useDepth);
      if (this.mode === "recipe") {
        setWidgetValue(
          this.targetNode,
          "portrait_id",
          this.recipeSelection.portrait
        );
        setWidgetValue(
          this.targetNode,
          "costume_id",
          this.recipeSelection.costume
        );
        setWidgetValue(this.targetNode, "pose_id", this.recipeSelection.pose);
      } else {
        setWidgetValue(
          this.targetNode,
          "image_id",
          this.recipeSelection[this.activeLib]
        );
      }
      if (typeof this.targetNode.pcaRefreshPreview === "function") {
        this.targetNode.pcaRefreshPreview();
      }
    } else if (window.LiteGraph) {
      const node = window.LiteGraph.createNode("CharacterRecipeNode");
      if (node) {
        app.graph.add(node);
        node.pos = [200, 200];
        setWidgetValue(node, "portrait_id", this.recipeSelection.portrait);
        setWidgetValue(node, "costume_id", this.recipeSelection.costume);
        setWidgetValue(node, "costume_view", this.costumeView);
        setWidgetValue(node, "pose_id", this.recipeSelection.pose);
        if (typeof node.pcaRefreshPreview === "function") {
          node.pcaRefreshPreview();
        }
      }
    }
    this.close();
  }
}

const modalInstance = new PoseAtlasModal();

function attachNodePreviewWidget(node, nodeKind) {
  injectStylesheet();
  const container = document.createElement("div");
  container.className = "pca-node-preview";

  const refresh = () => {
    container.innerHTML = "";
    const useDepth = Boolean(findWidget(node, "use_depth")?.value);
    if (nodeKind === "recipe") {
      const slots = [
        {
          lib: "portrait",
          label: "Portrait",
          val:
            findWidget(node, "portrait_id")?.value ||
            LIBRARIES.portrait.defaultId,
        },
        {
          lib: "costume",
          label: "Costume",
          val:
            findWidget(node, "costume_id")?.value ||
            LIBRARIES.costume.defaultId,
        },
        {
          lib: "pose",
          label: useDepth ? "Pose (depth)" : "Pose",
          val: findWidget(node, "pose_id")?.value || LIBRARIES.pose.defaultId,
        },
      ];
      slots.forEach((s) => {
        const card = document.createElement("div");
        card.className = "pca-node-thumb-card";
        card.title = `Click to change ${s.label} reference`;
        card.innerHTML = `
          <img src="${(s.lib === "costume" ? `/pose_character_atlas/image?library=costume&id=${encodeURIComponent(s.val)}&kind=thumb&view=${encodeURIComponent(findWidget(node, "costume_view")?.value || "front")}` : getThumbUrl(s.lib, s.val, null, useDepth))}" alt="${s.val}" />
          <div class="pca-node-thumb-label">${s.label} #${s.val}</div>
        `;
        card.addEventListener("click", () => {
          modalInstance.open({ node, initialLib: s.lib, mode: "recipe" });
        });
        container.appendChild(card);
      });
    } else {
      const id =
        findWidget(node, "image_id")?.value || LIBRARIES[nodeKind].defaultId;
      const card = document.createElement("div");
      card.className = "pca-node-thumb-card";
      card.title = "Click to open the library";
      card.innerHTML = `
        <img src="${(nodeKind === "costume" ? `/pose_character_atlas/image?library=costume&id=${encodeURIComponent(id)}&kind=thumb&view=${encodeURIComponent(findWidget(node, "costume_view")?.value || "front")}` : getThumbUrl(nodeKind, id, null, useDepth))}" alt="${id}" />
        <div class="pca-node-thumb-label">${LIBRARIES[nodeKind].shortLabel}${nodeKind === "pose" && useDepth ? " (depth)" : ""} #${id}</div>
      `;
      card.addEventListener("click", () => {
        modalInstance.open({ node, initialLib: nodeKind, mode: "single" });
      });
      container.appendChild(card);
    }
  };

  node.pcaRefreshPreview = refresh;

  if (typeof node.addDOMWidget === "function") {
    node.addDOMWidget("pca_preview", "preview", container, {
      serialize: false,
      hideOnZoom: false,
    });
  }

  ["image_id", "portrait_id", "costume_id", "pose_id", "use_depth", "costume_view"].forEach((wName) => {
    const w = findWidget(node, wName);
    if (w) {
      const origCb = w.callback;
      w.callback = function () {
        if (typeof origCb === "function") origCb.apply(this, arguments);
        refresh();
      };
    }
  });

  refresh();
}

app.registerExtension({
  name: "PoseCharacterAtlas.Gallery",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeKind = NODE_LIB_MAP[nodeData.name];
    if (!nodeKind) return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origOnNodeCreated
        ? origOnNodeCreated.apply(this, arguments)
        : undefined;

      const btnLabel =
        nodeKind === "recipe"
          ? "🎨 Open 3-in-1 picker"
          : `🖼️ Open ${LIBRARIES[nodeKind].shortLabel} library`;

      this.addWidget("button", btnLabel, null, () => {
        modalInstance.open({
          node: this,
          initialLib: nodeKind === "recipe" ? "portrait" : nodeKind,
          mode: nodeKind === "recipe" ? "recipe" : "single",
        });
      });

      attachNodePreviewWidget(this, nodeKind);
      if (this.size && this.size[1] < 340) {
        this.setSize([Math.max(this.size[0], 310), 360]);
      }
      return r;
    };
  },
});
