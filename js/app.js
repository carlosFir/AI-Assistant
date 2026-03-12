/* ============================================
   AI 助理 - 日程管理中心 主逻辑
   ============================================ */

(function () {
  "use strict";

  const DATA_PATHS = {
    schedule: "data/schedule.json",
    tasks: "data/tasks.json",
    notes: "data/notes.json",
    reminders: "data/reminders.json",
  };

  const CATEGORY_MAP = {
    work: "工作",
    personal: "个人",
    meeting: "会议",
    health: "健康",
    study: "学习",
    other: "其他",
  };

  const STATUS_MAP = {
    pending: "待处理",
    "in-progress": "进行中",
    completed: "已完成",
    active: "活跃",
    paused: "已暂停",
  };

  const PRIORITY_MAP = {
    high: "高",
    medium: "中",
    low: "低",
  };

  const REPEAT_MAP = {
    daily: "每天",
    weekly: "每周",
    monthly: "每月",
    yearly: "每年",
    once: "仅一次",
    none: "不重复",
  };

  let store = {
    schedule: [],
    tasks: [],
    notes: [],
    reminders: [],
    fitness: [],
  };

  let loadErrors = {
    schedule: false,
    tasks: false,
    notes: false,
    reminders: false,
  };

  let scheduleFilterMode = "today";
  let scheduleFilterDate = null;
  let scheduleViewMode = "list";

  let fitnessFilterDate = null;
  let fitnessSelectedDate = null;
  let fitnessPage = 1;
  const FITNESS_PAGE_SIZE = 6;

  const LOCAL_KEYS = {
    schedule: "ai-assistant-local-schedule",
    tasks: "ai-assistant-local-tasks",
    notes: "ai-assistant-local-notes",
    reminders: "ai-assistant-local-reminders",
    fitness: "ai-assistant-local-fitness",
  };

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLocal(key, items) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch (e) {
      console.warn("localStorage save failed", e);
    }
  }

  // ============ Data Loading ============

  async function loadJSON(path) {
    try {
      const res = await fetch(path + "?t=" + Date.now());
      if (res.ok) {
        const json = await res.json();
        return { data: json.items || [], error: false };
      }
      const fallback = path.replace(/\.json$/i, ".example.json");
      if (fallback !== path) {
        const resExample = await fetch(fallback + "?t=" + Date.now());
        if (resExample.ok) {
          const json = await resExample.json();
          return { data: json.items || [], error: false };
        }
      }
      return { data: [], error: true };
    } catch {
      return { data: [], error: true };
    }
  }

  async function loadAllData() {
    const [s, t, n, r] = await Promise.all([
      loadJSON(DATA_PATHS.schedule),
      loadJSON(DATA_PATHS.tasks),
      loadJSON(DATA_PATHS.notes),
      loadJSON(DATA_PATHS.reminders),
    ]);
    const localS = loadLocal(LOCAL_KEYS.schedule);
    const localT = loadLocal(LOCAL_KEYS.tasks);
    const localN = loadLocal(LOCAL_KEYS.notes);
    const localR = loadLocal(LOCAL_KEYS.reminders);
    const localF = loadLocal(LOCAL_KEYS.fitness);
    store.schedule = (s.data || []).concat(localS);
    store.tasks = (t.data || []).concat(localT);
    store.notes = (n.data || []).concat(localN);
    store.reminders = (r.data || []).concat(localR);
    store.fitness = localF || [];
    loadErrors.schedule = s.error;
    loadErrors.tasks = t.error;
    loadErrors.notes = n.error;
    loadErrors.reminders = r.error;
  }

  function getLocalItems(storeKey) {
    const list = store[storeKey] || [];
    return list.filter((item) => String(item.id || "").startsWith("local-"));
  }

  function saveLocalStore(storeKey) {
    const key = LOCAL_KEYS[storeKey];
    if (!key) return;
    saveLocal(key, getLocalItems(storeKey));
  }

  // ============ Utilities ============

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function getThisWeekRange() {
    const d = new Date();
    const day = d.getDay();
    const monOffset = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + monOffset);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const pad = (n) => String(n).padStart(2, "0");
    return {
      start: `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`,
      end: `${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`,
    };
  }

  function getNextWeekRange() {
    const r = getThisWeekRange();
    const addDays = (str, n) => {
      const d = new Date(str);
      d.setDate(d.getDate() + n);
      const pad = (x) => String(x).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    return { start: addDays(r.start, 7), end: addDays(r.end, 7) };
  }

  function formatDateTime(dt) {
    if (!dt) return "-";
    const d = new Date(dt);
    if (isNaN(d)) return dt;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getReminderNextTime(reminder) {
    if (!reminder || reminder.status !== "active") return null;
    const dt = reminder.datetime;
    if (!dt) return null;
    const base = new Date(dt);
    if (isNaN(base.getTime())) return null;
    const repeat = (reminder.repeat || "").toLowerCase();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timeStr = pad(base.getHours()) + ":" + pad(base.getMinutes());
    if (repeat === "daily" || repeat === "每天") {
      const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), base.getHours(), base.getMinutes(), 0);
      if (now < todayAt) return "下次：今天 " + timeStr;
      return "下次：明天 " + timeStr;
    }
    if (repeat === "weekly" || repeat === "每周") {
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      return "下次：每周" + dayNames[base.getDay()] + " " + timeStr;
    }
    if (repeat === "monthly" || repeat === "每月") {
      return "下次：每月" + base.getDate() + "日 " + timeStr;
    }
    if (repeat === "yearly" || repeat === "每年") {
      return "下次：每年" + (base.getMonth() + 1) + "/" + base.getDate() + " " + timeStr;
    }
    return null;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function makeBadge(text, cls) {
    return `<span class="badge badge-${cls}">${escapeHtml(text)}</span>`;
  }

  function makeTags(tags) {
    if (!tags || !tags.length) return "";
    return tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  }

  function searchAll(keyword) {
    const k = (keyword || "").trim().toLowerCase();
    if (!k) return { schedule: [], tasks: [], notes: [], reminders: [] };
    const match = (text) => (text || "").toLowerCase().includes(k);
    return {
      schedule: store.schedule.filter((s) => match(s.title) || match(s.description)),
      tasks: store.tasks.filter((t) => match(t.title) || match(t.description) || (t.tags && t.tags.some((tag) => match(tag)))),
      notes: store.notes.filter((n) => match(n.title) || match(n.content) || (n.tags && n.tags.some((tag) => match(tag)))),
      reminders: store.reminders.filter((r) => match(r.title) || match(r.description)),
    };
  }

  function renderSearchResults(keyword) {
    const el = document.getElementById("searchResults");
    if (!el) return;
    const k = (keyword || "").trim();
    if (!k) {
      el.classList.remove("active");
      el.innerHTML = "";
      return;
    }
    const result = searchAll(k);
    const total = result.schedule.length + result.tasks.length + result.notes.length + result.reminders.length;
    if (total === 0) {
      el.classList.add("active");
      el.innerHTML = '<div class="search-no-result">未找到相关结果</div>';
      return;
    }
    let html = "";
    if (result.schedule.length) {
      html += '<div class="search-result-group"><div class="search-result-group-title">📅 日程</div>';
      result.schedule.slice(0, 5).forEach((s) => {
        html += `<div class="search-result-item">${escapeHtml(s.date)} ${escapeHtml(s.time || "")} <strong>${escapeHtml(s.title)}</strong><div class="search-result-item-desc">${escapeHtml((s.description || "").slice(0, 50))}</div></div>`;
      });
      if (result.schedule.length > 5) html += `<div class="search-result-item" style="color:var(--text-muted)">共 ${result.schedule.length} 条…</div>`;
      html += "</div>";
    }
    if (result.tasks.length) {
      html += '<div class="search-result-group"><div class="search-result-group-title">✅ 任务</div>';
      result.tasks.slice(0, 5).forEach((t) => {
        html += `<div class="search-result-item"><strong>${escapeHtml(t.title)}</strong> ${t.deadline ? "· " + escapeHtml(t.deadline) : ""}<div class="search-result-item-desc">${escapeHtml((t.description || "").slice(0, 50))}</div></div>`;
      });
      if (result.tasks.length > 5) html += `<div class="search-result-item" style="color:var(--text-muted)">共 ${result.tasks.length} 条…</div>`;
      html += "</div>";
    }
    if (result.notes.length) {
      html += '<div class="search-result-group"><div class="search-result-group-title">📝 备忘录</div>';
      result.notes.slice(0, 5).forEach((n) => {
        html += `<div class="search-result-item"><strong>${escapeHtml(n.title)}</strong><div class="search-result-item-desc">${escapeHtml((n.content || "").slice(0, 50))}</div></div>`;
      });
      if (result.notes.length > 5) html += `<div class="search-result-item" style="color:var(--text-muted)">共 ${result.notes.length} 条…</div>`;
      html += "</div>";
    }
    if (result.reminders.length) {
      html += '<div class="search-result-group"><div class="search-result-group-title">🔔 提醒</div>';
      result.reminders.slice(0, 5).forEach((r) => {
        html += `<div class="search-result-item"><strong>${escapeHtml(r.title)}</strong><div class="search-result-item-desc">${getReminderNextTime(r) || formatDateTime(r.datetime)}</div></div>`;
      });
      if (result.reminders.length > 5) html += `<div class="search-result-item" style="color:var(--text-muted)">共 ${result.reminders.length} 条…</div>`;
      html += "</div>";
    }
    el.classList.add("active");
    el.innerHTML = html;
  }

  // ============ Clock ============

  function updateClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const clockEl = document.getElementById("clock");
    const dateEl = document.getElementById("dateDisplay");
    if (clockEl) {
      clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }
    if (dateEl) {
      const days = ["日", "一", "二", "三", "四", "五", "六"];
      dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 周${days[now.getDay()]}`;
    }
  }

  // ============ Navigation ============

  function initNav() {
    const navItems = document.querySelectorAll(".nav-item");
    const panels = document.querySelectorAll(".panel");
    const titleMap = {
      dashboard: "总览",
      schedule: "日程安排",
      tasks: "待办任务",
      notes: "备忘录",
      reminders: "提醒事项",
      fitness: "健身计划",
    };

    navItems.forEach((item) => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        const target = item.dataset.panel;

        navItems.forEach((n) => n.classList.remove("active"));
        item.classList.add("active");

        panels.forEach((p) => p.classList.remove("active"));
        const targetPanel = document.getElementById("panel-" + target);
        if (targetPanel) targetPanel.classList.add("active");

        document.getElementById("pageTitle").textContent =
          titleMap[target] || target;
      });
    });

    const toggle = document.getElementById("sidebarToggle");
    const sidebar = document.getElementById("sidebar");
    if (toggle && sidebar) {
      toggle.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
      });
    }
  }

  // ============ Dashboard Rendering ============

  function renderDashboard() {
    const today = todayStr();

    const todaySchedules = store.schedule.filter((s) => s.date === today);
    const pendingTasks = store.tasks.filter(
      (t) => t.status !== "completed"
    );
    const activeReminders = store.reminders.filter(
      (r) => r.status === "active"
    );

    document.getElementById("statSchedule").textContent = todaySchedules.length;
    document.getElementById("statTasks").textContent = pendingTasks.length;
    document.getElementById("statNotes").textContent = store.notes.length;
    document.getElementById("statReminders").textContent = activeReminders.length;

    const dashSchedule = document.getElementById("dashSchedule");
    if (loadErrors.schedule) {
      dashSchedule.innerHTML = '<div class="empty-state load-error-inline">⚠️ 数据加载失败，请检查 data 目录或刷新重试</div>';
    } else if (todaySchedules.length === 0) {
      dashSchedule.innerHTML = '<div class="empty-state">今天暂无日程安排</div><p class="empty-hint" style="margin-top:8px;">在聊天里对我说一句，我帮你记下来</p>';
    } else {
      dashSchedule.innerHTML = todaySchedules
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
        .map(
          (s) => `
        <div class="dash-item">
          <span class="dash-item-time">${escapeHtml(s.time || "")}</span>
          <div>
            <div class="dash-item-title">${escapeHtml(s.title)}</div>
            ${s.description ? `<div class="dash-item-desc">${escapeHtml(s.description)}</div>` : ""}
          </div>
          <div class="dash-item-badge">${makeBadge(STATUS_MAP[s.status] || s.status, s.status)}</div>
        </div>`
        )
        .join("");
    }

    const dashTasks = document.getElementById("dashTasks");
    if (loadErrors.tasks) {
      dashTasks.innerHTML = '<div class="empty-state load-error-inline">⚠️ 数据加载失败，请检查 data 目录或刷新重试</div>';
    } else if (pendingTasks.length === 0) {
      dashTasks.innerHTML = '<div class="empty-state">所有任务已完成 🎉</div><p class="empty-hint" style="margin-top:8px;">在聊天里对我说一句，我帮你记下来</p>';
    } else {
      dashTasks.innerHTML = pendingTasks
        .slice(0, 5)
        .map(
          (t) => `
        <div class="dash-item">
          <span class="dash-item-time">${makeBadge(PRIORITY_MAP[t.priority] || t.priority, t.priority)}</span>
          <div>
            <div class="dash-item-title">${escapeHtml(t.title)}</div>
            ${t.deadline ? `<div class="dash-item-desc">截止：${escapeHtml(t.deadline)}</div>` : ""}
          </div>
          <div class="dash-item-badge">${makeBadge(STATUS_MAP[t.status] || t.status, t.status)}</div>
        </div>`
        )
        .join("");
    }

    const dashNotes = document.getElementById("dashNotes");
    if (loadErrors.notes) {
      dashNotes.innerHTML = '<div class="empty-state load-error-inline">⚠️ 数据加载失败，请检查 data 目录或刷新重试</div>';
    } else if (store.notes.length === 0) {
      dashNotes.innerHTML = '<div class="empty-state">暂无备忘录</div><p class="empty-hint" style="margin-top:8px;">在聊天里对我说一句，我帮你记下来</p>';
    } else {
      dashNotes.innerHTML = store.notes
        .slice(-3)
        .reverse()
        .map(
          (n) => `
        <div class="dash-item">
          <div>
            <div class="dash-item-title">${escapeHtml(n.title)}</div>
            <div class="dash-item-desc">${escapeHtml((n.content || "").slice(0, 60))}${(n.content || "").length > 60 ? "..." : ""}</div>
          </div>
        </div>`
        )
        .join("");
    }

    const dashReminders = document.getElementById("dashReminders");
    if (loadErrors.reminders) {
      dashReminders.innerHTML = '<div class="empty-state load-error-inline">⚠️ 数据加载失败，请检查 data 目录或刷新重试</div>';
    } else if (activeReminders.length === 0) {
      dashReminders.innerHTML = '<div class="empty-state">暂无活跃提醒</div><p class="empty-hint" style="margin-top:8px;">在聊天里对我说一句，我帮你记下来</p>';
    } else {
      dashReminders.innerHTML = activeReminders
        .slice(0, 5)
        .map(
          (r) => `
        <div class="dash-item">
          <div>
            <div class="dash-item-title">${escapeHtml(r.title)}</div>
            <div class="dash-item-desc">${getReminderNextTime(r) || formatDateTime(r.datetime)}</div>
          </div>
          <div class="dash-item-badge">${makeBadge(STATUS_MAP[r.status] || r.status, r.status)}</div>
        </div>`
        )
        .join("");
    }
  }

  // ============ Schedule Table ============

  function getScheduleFilteredItems() {
    let items = store.schedule;
    if (scheduleFilterMode === "today" && scheduleFilterDate) {
      items = items.filter((s) => s.date === scheduleFilterDate);
    } else if (scheduleFilterMode === "week") {
      const r = getThisWeekRange();
      items = items.filter((s) => s.date >= r.start && s.date <= r.end);
    } else if (scheduleFilterMode === "nextWeek") {
      const r = getNextWeekRange();
      items = items.filter((s) => s.date >= r.start && s.date <= r.end);
    }
    return items.sort((a, b) => {
      const dc = (a.date || "").localeCompare(b.date || "");
      if (dc !== 0) return dc;
      return (a.time || "").localeCompare(b.time || "");
    });
  }

  function updateScheduleFilterHint() {
    const hint = document.getElementById("scheduleFilterHint");
    if (!hint) return;
    if (scheduleFilterMode === "today" && scheduleFilterDate) {
      hint.textContent = "当前：今天 " + scheduleFilterDate;
    } else if (scheduleFilterMode === "week") {
      const r = getThisWeekRange();
      hint.textContent = "当前：本周 " + r.start + " 至 " + r.end;
    } else if (scheduleFilterMode === "nextWeek") {
      const r = getNextWeekRange();
      hint.textContent = "当前：下周 " + r.start + " 至 " + r.end;
    } else {
      hint.textContent = "当前：全部";
    }
  }

  function setScheduleFilterButtonsActive() {
    const ids = ["scheduleTodayBtn", "scheduleWeekBtn", "scheduleNextWeekBtn", "scheduleAllBtn"];
    const modes = ["today", "week", "nextWeek", "all"];
    ids.forEach((id, i) => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle("btn-filter-active", scheduleFilterMode === modes[i]);
    });
  }

  function renderScheduleTable() {
    const tbody = document.getElementById("scheduleBody");
    const empty = document.getElementById("scheduleEmpty");
    const loadErr = document.getElementById("scheduleLoadError");
    const table = document.getElementById("scheduleTable");

    if (loadErrors.schedule) {
      table.style.display = "none";
      empty.style.display = "none";
      if (loadErr) loadErr.style.display = "block";
      return;
    }
    if (loadErr) loadErr.style.display = "none";

    const items = getScheduleFilteredItems();
    if (items.length === 0) {
      tbody.innerHTML = "";
      table.style.display = "none";
      empty.style.display = "block";
    } else {
      table.style.display = "";
      empty.style.display = "none";
      tbody.innerHTML = items
        .map(
          (s) => `
        <tr>
          <td>${escapeHtml(s.date || "-")}</td>
          <td>${escapeHtml(s.time || "-")}</td>
          <td>${escapeHtml(s.endTime || "-")}</td>
          <td><strong>${escapeHtml(s.title)}</strong></td>
          <td>${escapeHtml(s.description || "-")}</td>
          <td>${makeBadge(CATEGORY_MAP[s.category] || s.category || "其他", s.category || "other")}</td>
          <td>${makeBadge(STATUS_MAP[s.status] || s.status, s.status)}</td>
        </tr>`
        )
        .join("");
    }
    updateScheduleFilterHint();
    setScheduleFilterButtonsActive();
  }

  function initScheduleFilters() {
    scheduleFilterDate = todayStr();
    const dateInput = document.getElementById("scheduleDate");
    const todayBtn = document.getElementById("scheduleTodayBtn");
    const weekBtn = document.getElementById("scheduleWeekBtn");
    const nextWeekBtn = document.getElementById("scheduleNextWeekBtn");
    const allBtn = document.getElementById("scheduleAllBtn");

    dateInput.value = todayStr();

    function applyScheduleFilter() {
      renderScheduleTable();
      if (scheduleViewMode === "calendar") renderScheduleCalendar();
    }
    dateInput.addEventListener("change", () => {
      scheduleFilterMode = "today";
      scheduleFilterDate = dateInput.value || todayStr();
      applyScheduleFilter();
    });
    todayBtn.addEventListener("click", () => {
      scheduleFilterMode = "today";
      scheduleFilterDate = todayStr();
      dateInput.value = scheduleFilterDate;
      applyScheduleFilter();
    });
    if (weekBtn) {
      weekBtn.addEventListener("click", () => {
        scheduleFilterMode = "week";
        scheduleFilterDate = null;
        dateInput.value = getThisWeekRange().start;
        applyScheduleFilter();
      });
    }
    if (nextWeekBtn) {
      nextWeekBtn.addEventListener("click", () => {
        scheduleFilterMode = "nextWeek";
        scheduleFilterDate = null;
        dateInput.value = getNextWeekRange().start;
        applyScheduleFilter();
      });
    }
    allBtn.addEventListener("click", () => {
      scheduleFilterMode = "all";
      scheduleFilterDate = null;
      dateInput.value = "";
      applyScheduleFilter();
    });
  }

  // ============ Tasks Table ============

  function renderTasksTable(statusFilter, priorityFilter) {
    const loadErr = document.getElementById("tasksLoadError");
    const table = document.getElementById("tasksTable");
    const empty = document.getElementById("tasksEmpty");
    if (loadErrors.tasks) {
      if (loadErr) loadErr.style.display = "block";
      table.style.display = "none";
      empty.style.display = "none";
      return;
    }
    if (loadErr) loadErr.style.display = "none";

    let items = store.tasks;
    if (statusFilter && statusFilter !== "all") {
      items = items.filter((t) => t.status === statusFilter);
    }
    if (priorityFilter && priorityFilter !== "all") {
      items = items.filter((t) => t.priority === priorityFilter);
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    items = items.sort(
      (a, b) =>
        (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
    );

    const tbody = document.getElementById("tasksBody");

    if (items.length === 0) {
      tbody.innerHTML = "";
      table.style.display = "none";
      empty.style.display = "block";
    } else {
      table.style.display = "";
      empty.style.display = "none";
      tbody.innerHTML = items
        .map(
          (t) => `
        <tr>
          <td>${makeBadge(PRIORITY_MAP[t.priority] || t.priority, t.priority)}</td>
          <td><strong>${escapeHtml(t.title)}</strong></td>
          <td>${escapeHtml(t.description || "-")}</td>
          <td>${escapeHtml(t.deadline || "-")}</td>
          <td>${makeBadge(STATUS_MAP[t.status] || t.status, t.status)}</td>
          <td>${makeTags(t.tags)}</td>
        </tr>`
        )
        .join("");
    }
  }

  function initTaskFilters() {
    const statusFilter = document.getElementById("taskFilter");
    const priorityFilter = document.getElementById("taskPriorityFilter");

    const render = () =>
      renderTasksTable(statusFilter.value, priorityFilter.value);
    statusFilter.addEventListener("change", render);
    priorityFilter.addEventListener("change", render);
  }

  // ============ Notes Grid ============

  function renderNotes() {
    const grid = document.getElementById("notesGrid");
    const empty = document.getElementById("notesEmpty");
    const loadErr = document.getElementById("notesLoadError");
    if (loadErrors.notes) {
      grid.style.display = "none";
      empty.style.display = "none";
      if (loadErr) loadErr.style.display = "block";
      return;
    }
    if (loadErr) loadErr.style.display = "none";

    if (store.notes.length === 0) {
      grid.style.display = "none";
      empty.style.display = "block";
    } else {
      grid.style.display = "";
      empty.style.display = "none";

      const colors = [
        "var(--primary)",
        "var(--success)",
        "var(--accent)",
        "var(--danger)",
        "var(--info)",
      ];

      grid.innerHTML = store.notes
        .slice()
        .reverse()
        .map(
          (n, i) => `
        <div class="note-card" style="border-left-color: ${colors[i % colors.length]}">
          <div class="note-card-title">${escapeHtml(n.title)}</div>
          <div class="note-card-content">${escapeHtml(n.content || "")}</div>
          <div class="note-card-footer">
            <span class="note-card-date">${escapeHtml(n.createdAt || "")}</span>
            <div class="note-card-tags">${makeTags(n.tags)}</div>
          </div>
        </div>`
        )
        .join("");
    }
  }

  // ============ Reminders Table ============

  function renderReminders() {
    const loadErr = document.getElementById("remindersLoadError");
    const table = document.getElementById("remindersTable");
    const empty = document.getElementById("remindersEmpty");
    if (loadErrors.reminders) {
      if (loadErr) loadErr.style.display = "block";
      table.style.display = "none";
      empty.style.display = "none";
      return;
    }
    if (loadErr) loadErr.style.display = "none";

    const items = store.reminders.sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return (a.datetime || "").localeCompare(b.datetime || "");
    });

    const tbody = document.getElementById("remindersBody");

    if (items.length === 0) {
      tbody.innerHTML = "";
      table.style.display = "none";
      empty.style.display = "block";
    } else {
      table.style.display = "";
      empty.style.display = "none";
      tbody.innerHTML = items
        .map(
          (r) => `
        <tr>
          <td>${makeBadge(STATUS_MAP[r.status] || r.status, r.status)}</td>
          <td><strong>${escapeHtml(r.title)}</strong></td>
          <td>${escapeHtml(r.description || "-")}</td>
          <td>${getReminderNextTime(r) || formatDateTime(r.datetime)}</td>
          <td><span class="repeat-label">${REPEAT_MAP[r.repeat] || r.repeat || "不重复"}</span></td>
        </tr>`
        )
        .join("");
    }
  }

  // ============ Render All ============

  function renderAll() {
    renderDashboard();
    renderScheduleTable();
    renderTasksTable(
      document.getElementById("taskFilter").value,
      document.getElementById("taskPriorityFilter").value
    );
    renderNotes();
    renderReminders();
    renderFitness();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    document.getElementById("lastUpdate").textContent =
      `上次刷新：${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // ============ Fitness Plan ============

  function getFitnessItemsByDate(dateStr) {
    const d = dateStr || todayStr();
    return (store.fitness || [])
      .filter((f) => f.date === d)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  function getFitnessDates() {
    const set = new Set();
    (store.fitness || []).forEach((f) => {
      if (f.date) set.add(f.date);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a)); // 最近在前
  }

  function getFitnessCardData(dateStr) {
    const items = getFitnessItemsByDate(dateStr);
    const totalSets = items.reduce((sum, it) => sum + (parseInt(it.sets, 10) || 0), 0);
    // 统计有实际组数的动作数量
    const actionsWithSets = new Set();
    items.forEach((it) => {
      if ((parseInt(it.sets, 10) || 0) > 0 && (it.action || it.item)) {
        actionsWithSets.add(it.action || it.item);
      }
    });
    const totalActions = actionsWithSets.size;
    const reflection = (items[0] && items[0].reflection) || "";
    return { items, totalActions, totalSets, reflection };
  }

  function saveFitnessFromEditor() {
    const tbody = document.getElementById("fitnessEditorBody");
    const reflectionInput = document.getElementById("fitnessReflectionInput");
    if (!tbody || !fitnessSelectedDate) return;
    const date = fitnessSelectedDate;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const byId = {};
    (store.fitness || []).forEach((f) => {
      if (f.id) byId[f.id] = f;
    });
    const reflection = reflectionInput ? reflectionInput.value.trim() : "";

    let lastAction = "";
    const setIndexByAction = {};
    const updatedForDate = rows.map((row, index) => {
      const id = row.getAttribute("data-id") || "local-fit-" + Date.now() + "-" + index;
      const getVal = (cls) => {
        const input = row.querySelector("." + cls);
        return input ? input.value.trim() : "";
      };
      const prev = byId[id] || {};
      let action = getVal("fitness-action");
      const reps = getVal("fitness-reps");
      const weightVal = getVal("fitness-weight-value");
      const unitEl = row.querySelector(".fitness-weight-unit");
      const unit = unitEl ? unitEl.value : "kg";
      const weight = weightVal ? weightVal + unit : "";
      const notes = getVal("fitness-notes");
      if (!action && lastAction) {
        action = lastAction;
      }
      if (action) {
        lastAction = action;
      }
      // 只有在该行有实际训练数据（次数或重量）时才计为一组
      let sets = "";
      const hasSetData = !!(reps || weightVal);
      if (hasSetData && action) {
        const key = action.trim();
        setIndexByAction[key] = (setIndexByAction[key] || 0) + 1;
        sets = String(setIndexByAction[key]);
      }
      return {
        id,
        date,
        time: prev.time || "18:00",
        action: action || prev.action || prev.item || "",
        sets,
        reps,
        weight,
        notes,
        reflection,
        syncedToSchedule: !!prev.syncedToSchedule,
      };
    });

    const others = (store.fitness || []).filter((f) => f.date !== date);
    store.fitness = others.concat(updatedForDate);
    saveLocalStore("fitness");
  }

  function renderFitnessCards() {
    const cardsEl = document.getElementById("fitnessCards");
    const empty = document.getElementById("fitnessEmpty");
    const pageInfo = document.getElementById("fitnessPageInfo");
    if (!cardsEl || !empty || !pageInfo) return;

    const allDates = getFitnessDates();
    const searchInput = document.getElementById("fitnessSearchInput");
    const dateFilterInput = document.getElementById("fitnessDateFilter");
    const keyword = (searchInput?.value || "").trim().toLowerCase();
    const dateFilter = dateFilterInput?.value || "";

    let filtered = allDates;
    if (dateFilter) {
      filtered = filtered.filter((d) => d === dateFilter);
    }
    if (keyword) {
      filtered = filtered.filter((d) => {
        if (d.toLowerCase().includes(keyword)) return true;
        const { items, reflection } = getFitnessCardData(d);
        const matchText = (txt) => (txt || "").toLowerCase().includes(keyword);
        if (matchText(reflection)) return true;
        return items.some((it) =>
          matchText(it.action || it.item) ||
          matchText(it.notes) ||
          matchText(it.weight)
        );
      });
    }

    if (!filtered.length) {
      cardsEl.innerHTML = "";
      empty.style.display = "block";
      pageInfo.textContent = "";
      return;
    }
    empty.style.display = "none";

    const totalPages = Math.max(1, Math.ceil(filtered.length / FITNESS_PAGE_SIZE));
    if (fitnessPage > totalPages) fitnessPage = totalPages;
    if (fitnessPage < 1) fitnessPage = 1;
    const start = (fitnessPage - 1) * FITNESS_PAGE_SIZE;
    const pageDates = filtered.slice(start, start + FITNESS_PAGE_SIZE);

    pageInfo.textContent = `第 ${fitnessPage} / ${totalPages} 页，共 ${filtered.length} 天`;

    cardsEl.innerHTML = pageDates
      .map((d) => {
        const { items, totalActions, totalSets, reflection } = getFitnessCardData(d);
        const dateObj = new Date(d + "T00:00:00");
        const days = ["日", "一", "二", "三", "四", "五", "六"];
        const label =
          isNaN(dateObj.getTime())
            ? d
            : `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(
                dateObj.getDate()
              ).padStart(2, "0")} 周${days[dateObj.getDay()]}`;
        const grouped = {};
        items.forEach((it) => {
          const action = (it.action || it.item || "").trim();
          const reps = parseInt(it.reps, 10) || 0;
          const hasSet = reps || (it.weight && String(it.weight).trim());
          if (!action || !hasSet) return;
          const weight = (it.weight || "").trim() || "未标重量";
          if (!grouped[action]) grouped[action] = {};
          if (!grouped[action][weight]) grouped[action][weight] = 0;
          grouped[action][weight] += 1;
        });
        const actionEntries = Object.entries(grouped);
        const lines = actionEntries.slice(0, 3).map(([action, weightsObj]) => {
          const weightParts = Object.entries(weightsObj)
            .map(([w, c]) => (w === "未标重量" ? `*${c}` : `${w}*${c}`))
            .join(" ");
          return `${action} ${weightParts}`;
        });
        const moreCount = actionEntries.length > 3 ? actionEntries.length - 3 : 0;
        const reflectionSnippet = reflection ? reflection.slice(0, 40) + (reflection.length > 40 ? "…" : "") : "";
        const selectedCls = fitnessSelectedDate === d ? " fitness-card selected" : "";
        return `
      <div class="fitness-card${selectedCls}" data-date="${escapeHtml(d)}">
        <div class="fitness-card-header">
          <div class="fitness-card-date">${escapeHtml(label)}</div>
          <div class="fitness-card-meta">${totalActions} 个动作 · ${totalSets} 组</div>
        </div>
        <div class="fitness-card-body">
          ${lines
            .map(
              (line) => `<div class="fitness-card-line" title="${escapeHtml(line)}">${escapeHtml(line)}</div>`
            )
            .join("")}
          ${moreCount ? `<div class="fitness-card-line" style="color:var(--text-muted);">还有 ${moreCount} 个动作…</div>` : ""}
        </div>
        ${
          reflectionSnippet
            ? `<div class="fitness-card-reflection"><strong>反思：</strong>${escapeHtml(reflectionSnippet)}</div>`
            : ""
        }
      </div>`;
      })
      .join("");
  }

  function renderFitnessEditor() {
    const tbody = document.getElementById("fitnessEditorBody");
    const dateLabel = document.getElementById("fitnessEditorDateLabel");
    const reflectionInput = document.getElementById("fitnessReflectionInput");
    if (!tbody || !dateLabel || !reflectionInput) return;

    const dates = getFitnessDates();
    if (!fitnessSelectedDate) {
      fitnessSelectedDate = dates.includes(todayStr())
        ? todayStr()
        : dates[0] || todayStr();
    }

    const date = fitnessSelectedDate;
    const items = getFitnessItemsByDate(date);
    const reflection = (items[0] && items[0].reflection) || "";

    const d = new Date(date + "T00:00:00");
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    const label = isNaN(d.getTime())
      ? date
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")} 周${days[d.getDay()]}`;
    dateLabel.textContent = label;

    if (!items.length) {
      tbody.innerHTML = "";
      reflectionInput.value = "";
      return;
    }

    let lastAction = "";
    tbody.innerHTML = items
      .map((f) => {
        const rawAction = f.action || f.item || "";
        const isSameAction = rawAction && rawAction === lastAction;
        const displayAction = isSameAction ? "" : rawAction;
        if (rawAction) lastAction = rawAction;
        const isSubRow = isSameAction || !!(parseInt(f.sets, 10));
        const isActionHead = !isSameAction && !parseInt(f.sets, 10);
        const rowClass = isSubRow ? "fitness-sub-row" : "fitness-action-row";

        let weightValue = "";
        let weightUnit = "kg";
        if (f.weight) {
          const m = String(f.weight).match(/^(\d+(?:\.\d+)?)(kg|lb)$/i);
          if (m) {
            weightValue = m[1];
            weightUnit = m[2].toLowerCase();
          } else {
            weightValue = f.weight;
          }
        }

        if (isActionHead) {
          return `
      <tr data-id="${escapeHtml(f.id || "")}" class="${rowClass}">
        <td><input class="fitness-input fitness-action" type="text" value="${escapeHtml(
          displayAction
        )}" placeholder="动作名称"></td>
        <td colspan="3"><input class="fitness-input fitness-notes" type="text" value="${escapeHtml(
          f.notes || ""
        )}" placeholder="备注"></td>
        <td></td>
        <td>
          <button type="button" class="fitness-add-set-btn" title="为该动作添加一组">+</button>
          <button type="button" class="fitness-delete-btn" title="删除该动作">×</button>
        </td>
      </tr>`;
        }

        return `
      <tr data-id="${escapeHtml(f.id || "")}" class="${rowClass}">
        <td><input class="fitness-input fitness-action" type="text" value="${escapeHtml(
          displayAction
        )}" placeholder="同上"></td>
        <td><input class="fitness-input fitness-sets" type="number" min="1" value="${escapeHtml(
          f.sets || ""
        )}" placeholder="#" readonly></td>
        <td><input class="fitness-input fitness-reps no-spin" type="number" min="1" value="${escapeHtml(
          f.reps || ""
        )}" placeholder="次数"></td>
        <td>
          <input class="fitness-input fitness-weight-value no-spin" type="number" min="0" step="0.5" value="${escapeHtml(
            weightValue
          )}" placeholder="重量">
          <select class="fitness-input fitness-weight-unit" style="margin-top:2px;">
            <option value="kg"${weightUnit === "kg" ? " selected" : ""}>kg</option>
            <option value="lb"${weightUnit === "lb" ? " selected" : ""}>lb</option>
          </select>
        </td>
        <td><input class="fitness-input fitness-notes" type="text" value="${escapeHtml(
          f.notes || ""
        )}" placeholder="备注"></td>
        <td>
          <button type="button" class="fitness-add-set-btn" title="在该动作下新增一组">+</button>
          <button type="button" class="fitness-delete-btn" title="删除本行">×</button>
        </td>
      </tr>`;
      })
      .join("");

    reflectionInput.value = reflection;
  }

  function renderFitness() {
    renderFitnessCards();
    renderFitnessEditor();
  }

  function initFitness() {
    const dateFilterInput = document.getElementById("fitnessDateFilter");
    const todayBtn = document.getElementById("fitnessTodayBtn");
    const prevPageBtn = document.getElementById("fitnessPrevPageBtn");
    const nextPageBtn = document.getElementById("fitnessNextPageBtn");
    const searchInput = document.getElementById("fitnessSearchInput");
    const cardsEl = document.getElementById("fitnessCards");
    const addRowBtn = document.getElementById("addFitnessRowBtn");
    const saveBtn = document.getElementById("saveFitnessBtn");
    const syncBtn = document.getElementById("syncFitnessToScheduleBtn");
    const editorTbody = document.getElementById("fitnessEditorBody");
    const createTodayBtn = document.getElementById("createTodayFitnessBtn");

    fitnessFilterDate = "";
    fitnessSelectedDate = null;
    fitnessPage = 1;

    if (dateFilterInput) {
      dateFilterInput.addEventListener("change", () => {
        fitnessFilterDate = dateFilterInput.value || "";
        fitnessPage = 1;
        renderFitness();
      });
    }

    if (todayBtn) {
      todayBtn.addEventListener("click", () => {
        const today = todayStr();
        if (dateFilterInput) dateFilterInput.value = today;
        fitnessFilterDate = today;
        fitnessSelectedDate = today;
        fitnessPage = 1;
        renderFitness();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        fitnessPage = 1;
        renderFitness();
      });
    }

    if (prevPageBtn) {
      prevPageBtn.addEventListener("click", () => {
        if (fitnessPage > 1) {
          fitnessPage -= 1;
          renderFitness();
        }
      });
    }

    if (nextPageBtn) {
      nextPageBtn.addEventListener("click", () => {
        const allDates = getFitnessDates();
        const searchVal = (searchInput?.value || "").trim();
        const dateFilter = dateFilterInput?.value || "";
        let filtered = allDates;
        if (dateFilter) filtered = filtered.filter((d) => d === dateFilter);
        if (searchVal) {
          const keyword = searchVal.toLowerCase();
          filtered = filtered.filter((d) => {
            if (d.toLowerCase().includes(keyword)) return true;
            const { items, reflection } = getFitnessCardData(d);
            const matchText = (txt) => (txt || "").toLowerCase().includes(keyword);
            if (matchText(reflection)) return true;
            return items.some((it) =>
              matchText(it.action || it.item) ||
              matchText(it.notes) ||
              matchText(it.weight)
            );
          });
        }
        const totalPages = Math.max(1, Math.ceil(filtered.length / FITNESS_PAGE_SIZE));
        if (fitnessPage < totalPages) {
          fitnessPage += 1;
          renderFitness();
        }
      });
    }

    if (cardsEl) {
      cardsEl.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest(".fitness-card");
        if (!card) return;
        const date = card.getAttribute("data-date");
        if (!date) return;
        fitnessSelectedDate = date;
        const editorCol = document.getElementById("fitnessEditorColumn");
        if (editorCol) editorCol.style.display = "";
        renderFitness();
      });
    }

    if (createTodayBtn) {
      createTodayBtn.addEventListener("click", () => {
        const today = todayStr();
        const hasToday = getFitnessItemsByDate(today).length > 0;
        if (!hasToday) {
          const id = "local-fit-" + Date.now();
          const fitnessItem = {
            id,
            date: today,
            time: "18:00",
            action: "",
            sets: "",
            reps: "",
            weight: "",
            notes: "",
            reflection: "",
            syncedToSchedule: false,
          };
          store.fitness.push(fitnessItem);
          saveLocalStore("fitness");
        }
        fitnessSelectedDate = today;
        if (dateFilterInput) dateFilterInput.value = "";
        fitnessFilterDate = "";
        fitnessPage = 1;
        const editorCol = document.getElementById("fitnessEditorColumn");
        if (editorCol) editorCol.style.display = "";
        renderFitness();
      });
    }

    if (addRowBtn) {
      addRowBtn.addEventListener("click", () => {
        // 新建一个「动作」头行：不包含具体组数，需通过右侧加号添加各组
        if (!fitnessSelectedDate) {
          fitnessSelectedDate = todayStr();
        }
        const date = fitnessSelectedDate;
        const id = "local-fit-" + Date.now();
        const fitnessItem = {
          id,
          date,
          time: "18:00",
          action: "",
          sets: "",
          reps: "",
          weight: "",
          notes: "",
          reflection: "",
          syncedToSchedule: false,
        };
        store.fitness.push(fitnessItem);
        saveLocalStore("fitness");
        renderFitnessEditor();
        renderFitnessCards();
      });
    }

    if (editorTbody) {
      editorTbody.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;

        const row = target.closest("tr");
        if (!row) return;

        // 行尾加号：在当前动作下添加一组（仅操作 DOM，保存时再写入 store）
        if (target.classList.contains("fitness-add-set-btn")) {
          // 工具函数：从当前行向上找「有效动作名」
          const getEffectiveAction = (tr) => {
            let cur = tr;
            while (cur) {
              const ai = cur.querySelector(".fitness-action");
              if (ai && ai.value.trim()) return ai.value.trim();
              cur = cur.previousElementSibling;
            }
            return "";
          };

          const actionName = getEffectiveAction(row);
          if (!actionName) return; // 没动作名，不新增

          // 找到该动作在 DOM 中的最后一行（同一「有效动作名」的连续块）
          const getRowEffectiveAction = (tr) => getEffectiveAction(tr);

          let insertRow = row;
          let next = row.nextElementSibling;
          while (next) {
            const eff = getRowEffectiveAction(next);
            if (eff === actionName) {
              insertRow = next;
              next = next.nextElementSibling;
            } else {
              break; // 遇到下一个动作块，停止
            }
          }

          // 计算新组号：该动作块最后一行的组数 + 1
          let lastSetNum = 0;
          let p = insertRow;
          while (p) {
            const eff = getRowEffectiveAction(p);
            if (eff !== actionName) break;
            const setInput = p.querySelector(".fitness-sets");
            if (setInput && setInput.value.trim()) {
              const n = parseInt(setInput.value.trim(), 10);
              if (!isNaN(n) && n > lastSetNum) {
                lastSetNum = n;
              }
            }
            p = p.previousElementSibling;
          }
          const newSetNum = lastSetNum + 1;

          // 克隆一行作为新组
          const newRow = insertRow.cloneNode(true);
          newRow.removeAttribute("data-id");

          const newActionInput = newRow.querySelector(".fitness-action");
          if (newActionInput) {
            newActionInput.value = "";
            newActionInput.placeholder = "同上一动作";
          }
          const newSetInput = newRow.querySelector(".fitness-sets");
          if (newSetInput) {
            newSetInput.value = String(newSetNum);
          }
          const newRepsInput = newRow.querySelector(".fitness-reps");
          if (newRepsInput) {
            newRepsInput.value = "";
          }
          const newWeightVal = newRow.querySelector(".fitness-weight-value");
          if (newWeightVal) {
            newWeightVal.value = "";
          }
          const newNotesInput = newRow.querySelector(".fitness-notes");
          if (newNotesInput) {
            newNotesInput.value = "";
          }
          newRow.classList.add("fitness-sub-row");

          insertRow.insertAdjacentElement("afterend", newRow);
          return;
        }

        // 删除一行（动作行或该动作下的某一组）
        if (target.classList.contains("fitness-delete-btn")) {
          const id = row.getAttribute("data-id");
          if (!id) {
            row.remove();
            return;
          }
          store.fitness = (store.fitness || []).filter((f) => f.id !== id);
          saveLocalStore("fitness");
          renderFitness();
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        saveFitnessFromEditor();
        renderFitness();
      });
    }

    if (syncBtn) {
      syncBtn.addEventListener("click", () => {
        if (!fitnessSelectedDate) return;
        saveFitnessFromEditor();
        const date = fitnessSelectedDate;
        const items = getFitnessItemsByDate(date);
        if (!items.length) return;

        const now = Date.now();
        let created = 0;
        items.forEach((f, idx) => {
          if (f.syncedToSchedule) return;
          const schedId = "local-fit-sch-" + now + "-" + idx;
          const descParts = [];
          if (f.sets) descParts.push("组数：" + f.sets);
          if (f.reps) descParts.push("次数：" + f.reps);
          if (f.weight) descParts.push("重量：" + f.weight);
          if (f.notes) descParts.push(f.notes);
          const description = descParts.join("；");
          const schedItem = {
            id: schedId,
            date,
            time: f.time || "18:00",
            endTime: "",
            title: f.action || f.item || "健身",
            description: description || "健身计划同步自「健身计划」模块。",
            category: "health",
            status: "pending",
          };
          store.schedule.push(schedItem);
          f.syncedToSchedule = true;
          created += 1;
        });

        if (created > 0) {
          saveLocalStore("schedule");
          saveLocalStore("fitness");
          renderScheduleTable();
          renderDashboard();
          if (scheduleViewMode === "calendar") renderScheduleCalendar();
          renderFitness();
        }
      });
    }
  }

  // ============ Init ============

  function initSearch() {
    const input = document.getElementById("globalSearch");
    const results = document.getElementById("searchResults");
    if (!input || !results) return;
    input.addEventListener("input", () => renderSearchResults(input.value));
    input.addEventListener("focus", () => { if (input.value.trim()) results.classList.add("active"); });
    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !results.contains(e.target)) results.classList.remove("active");
    });
  }

  function renderScheduleCalendar() {
    const header = document.getElementById("scheduleCalendarHeader");
    const grid = document.getElementById("scheduleCalendarGrid");
    if (!header || !grid) return;
    let startStr, endStr;
    if (scheduleFilterMode === "week") {
      const r = getThisWeekRange();
      startStr = r.start;
      endStr = r.end;
    } else if (scheduleFilterMode === "nextWeek") {
      const r = getNextWeekRange();
      startStr = r.start;
      endStr = r.end;
    } else if (scheduleFilterMode === "today" && scheduleFilterDate) {
      startStr = endStr = scheduleFilterDate;
    } else {
      const r = getThisWeekRange();
      startStr = r.start;
      endStr = r.end;
    }
    const days = [];
    const start = new Date(startStr + "T12:00:00");
    const end = new Date(endStr + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const pad = (n) => String(n).padStart(2, "0");
    header.innerHTML = "<div class=\"calendar-week-header-cell\">时间</div>" + days.map((d) => {
      const label = dayNames[d.getDay() === 0 ? 6 : d.getDay() - 1];
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
      return `<div class="calendar-week-header-cell">${label}<br><span class="calendar-week-day-date">${dateStr}</span></div>`;
    }).join("");
    const items = store.schedule.filter((s) => s.date >= startStr && s.date <= endStr);
    const byDate = {};
    items.forEach((s) => {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s);
    });
    Object.keys(byDate).forEach((dateStr) => byDate[dateStr].sort((a, b) => (a.time || "").localeCompare(b.time || "")));
    const rowCount = 14;
    let gridHtml = "";
    for (let row = 0; row < rowCount; row++) {
      const hour = 6 + row;
      gridHtml += `<div class="calendar-week-cell calendar-week-time">${hour}:00</div>`;
      days.forEach((d) => {
        const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const cellItems = (byDate[dateStr] || []).filter((s) => {
          const t = String(s.time || "0:0");
          const h = parseInt(t.split(":")[0], 10);
          return h >= hour && h < hour + 1;
        });
        const cellHtml = cellItems.map((s) => `<div class="calendar-event ${s.category || "other"}">${escapeHtml(s.time || "")} ${escapeHtml(s.title)}</div>`).join("");
        gridHtml += `<div class="calendar-week-cell">${cellHtml || ""}</div>`;
      });
    }
    grid.innerHTML = gridHtml;
    const cols = "60px repeat(" + days.length + ", 1fr)";
    grid.style.gridTemplateColumns = cols;
    if (header) header.style.gridTemplateColumns = cols;
  }

  function initScheduleViewToggle() {
    const listBtn = document.getElementById("scheduleViewListBtn");
    const calendarBtn = document.getElementById("scheduleViewCalendarBtn");
    const tableWrap = document.getElementById("scheduleTableWrap");
    const calendarWrap = document.getElementById("scheduleCalendarWrap");
    if (!listBtn || !calendarBtn) return;
    listBtn.addEventListener("click", () => {
      scheduleViewMode = "list";
      listBtn.classList.add("active");
      if (calendarBtn) calendarBtn.classList.remove("active");
      if (tableWrap) tableWrap.style.display = "";
      if (calendarWrap) calendarWrap.style.display = "none";
    });
    calendarBtn.addEventListener("click", () => {
      scheduleViewMode = "calendar";
      if (listBtn) listBtn.classList.remove("active");
      calendarBtn.classList.add("active");
      if (tableWrap) tableWrap.style.display = "none";
      if (calendarWrap) {
        calendarWrap.style.display = "block";
        renderScheduleCalendar();
      }
    });
    listBtn.classList.add("active");
  }

  // ============ Quick Add Modal (localStorage) ============

  function openAddModal(type) {
    const modal = document.getElementById("addModal");
    const form = document.getElementById("addForm");
    const titleEl = document.getElementById("addModalTitle");
    if (!modal || !form) return;
    document.getElementById("addFormType").value = type;
    const panelIds = { schedule: "addFormSchedule", tasks: "addFormTasks", notes: "addFormNotes", reminders: "addFormReminders" };
    Object.keys(panelIds).forEach((t) => {
      const panel = document.getElementById(panelIds[t]);
      if (panel) panel.style.display = t === type ? "block" : "none";
    });
    const titles = { schedule: "添加日程", tasks: "添加任务", notes: "添加备忘", reminders: "添加提醒" };
    if (titleEl) titleEl.textContent = titles[type] || "添加";
    const today = todayStr();
    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const nowStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (type === "schedule") {
      const dateEl = document.getElementById("addScheduleDate");
      if (dateEl) dateEl.value = today;
    }
    if (type === "reminders") {
      const dtEl = document.getElementById("addReminderDatetime");
      if (dtEl) dtEl.value = today + "T" + nowStr + ":00";
    }
    form.reset();
    if (type === "schedule") document.getElementById("addScheduleDate").value = today;
    if (type === "schedule") document.getElementById("addScheduleTime").value = "09:00";
    if (type === "schedule") document.getElementById("addScheduleEndTime").value = "10:00";
    if (type === "reminders") document.getElementById("addReminderDatetime").value = today + "T" + nowStr + ":00";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeAddModal() {
    const modal = document.getElementById("addModal");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  function handleAddSubmit(e) {
    e.preventDefault();
    const type = document.getElementById("addFormType").value;
    const id = "local-" + Date.now();
    const now = todayStr();

    if (type === "schedule" && !document.getElementById("addScheduleTitle").value.trim()) return;
    if (type === "tasks" && !document.getElementById("addTaskTitle").value.trim()) return;
    if (type === "notes" && !document.getElementById("addNoteTitle").value.trim()) return;
    if (type === "reminders" && !document.getElementById("addReminderTitle").value.trim()) return;

    if (type === "schedule") {
      const item = {
        id,
        date: document.getElementById("addScheduleDate").value || now,
        time: document.getElementById("addScheduleTime").value || "09:00",
        endTime: document.getElementById("addScheduleEndTime").value || "10:00",
        title: document.getElementById("addScheduleTitle").value.trim(),
        description: document.getElementById("addScheduleDesc").value.trim() || "",
        category: document.getElementById("addScheduleCategory").value || "other",
        status: "pending",
      };
      store.schedule.push(item);
      saveLocalStore("schedule");
    } else if (type === "tasks") {
      const tagsRaw = document.getElementById("addTaskTags").value.trim();
      const item = {
        id,
        title: document.getElementById("addTaskTitle").value.trim(),
        description: document.getElementById("addTaskDesc").value.trim() || "",
        priority: document.getElementById("addTaskPriority").value || "medium",
        status: "pending",
        deadline: document.getElementById("addTaskDeadline").value || "",
        createdAt: now,
        tags: tagsRaw ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
      };
      store.tasks.push(item);
      saveLocalStore("tasks");
    } else if (type === "notes") {
      const tagsRaw = document.getElementById("addNoteTags").value.trim();
      const item = {
        id,
        title: document.getElementById("addNoteTitle").value.trim(),
        content: document.getElementById("addNoteContent").value.trim() || "",
        createdAt: now,
        tags: tagsRaw ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
      };
      store.notes.push(item);
      saveLocalStore("notes");
    } else if (type === "reminders") {
      let dt = document.getElementById("addReminderDatetime").value;
      if (!dt) dt = new Date().toISOString().slice(0, 16);
      const item = {
        id,
        title: document.getElementById("addReminderTitle").value.trim(),
        description: document.getElementById("addReminderDesc").value.trim() || "",
        datetime: dt.length === 16 ? dt + ":00" : dt,
        repeat: document.getElementById("addReminderRepeat").value || "once",
        status: "active",
      };
      store.reminders.push(item);
      saveLocalStore("reminders");
    }
    closeAddModal();
    renderAll();
    if (scheduleViewMode === "calendar") renderScheduleCalendar();
  }

  function initAddModal() {
    const modal = document.getElementById("addModal");
    document.getElementById("addScheduleBtn")?.addEventListener("click", () => openAddModal("schedule"));
    document.getElementById("addTaskBtn")?.addEventListener("click", () => openAddModal("tasks"));
    document.getElementById("addNoteBtn")?.addEventListener("click", () => openAddModal("notes"));
    document.getElementById("addReminderBtn")?.addEventListener("click", () => openAddModal("reminders"));
    document.getElementById("addForm")?.addEventListener("submit", handleAddSubmit);
    document.getElementById("addModalClose")?.addEventListener("click", closeAddModal);
    document.getElementById("addModalCancel")?.addEventListener("click", closeAddModal);
    modal?.addEventListener("click", (e) => { if (e.target === modal) closeAddModal(); });
  }

  // ============ Browser Notifications ============

  function getReminderNextOccurrence(reminder) {
    if (!reminder || reminder.status !== "active" || !reminder.datetime) return null;
    const base = new Date(reminder.datetime);
    if (isNaN(base.getTime())) return null;
    const repeat = (reminder.repeat || "").toLowerCase();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    if (repeat === "daily" || repeat === "每天") {
      const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), base.getHours(), base.getMinutes(), 0);
      if (now < todayAt) return todayAt;
      const tomorrow = new Date(todayAt);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    if (repeat === "weekly" || repeat === "每周") {
      let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), base.getHours(), base.getMinutes(), 0);
      const targetDay = base.getDay();
      const currDay = d.getDay();
      let diff = targetDay - currDay;
      if (diff < 0 || (diff === 0 && now >= d)) diff += 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
    if (repeat === "monthly" || repeat === "每月") {
      let d = new Date(now.getFullYear(), now.getMonth(), base.getDate(), base.getHours(), base.getMinutes(), 0);
      if (now >= d) d.setMonth(d.getMonth() + 1);
      return d;
    }
    if (repeat === "once" || repeat === "none" || !repeat) return base;
    return base;
  }

  let lastNotifiedAt = {};
  const NOTIFY_WINDOW_MS = 60 * 1000;

  function checkReminderNotifications() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    store.reminders.filter((r) => r.status === "active").forEach((r) => {
      const next = getReminderNextOccurrence(r);
      if (!next) return;
      const key = r.id + "-" + Math.floor(next.getTime() / NOTIFY_WINDOW_MS);
      if (lastNotifiedAt[key]) return;
      if (now >= next.getTime() - 5000 && now <= next.getTime() + NOTIFY_WINDOW_MS) {
        lastNotifiedAt[key] = true;
        try {
          new Notification("提醒：" + (r.title || "提醒"), { body: r.description || "到点啦", icon: "/favicon.ico" });
        } catch (err) {
          console.warn(err);
        }
      }
    });
  }

  function initNotifications() {
    const banner = document.getElementById("notificationBanner");
    const enableBtn = document.getElementById("notificationEnableBtn");
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    if (Notification.permission === "denied") return;
    if (banner) banner.style.display = "flex";
    enableBtn?.addEventListener("click", () => {
      Notification.requestPermission().then((p) => {
        if (p === "granted" && banner) banner.style.display = "none";
      });
    });
    setInterval(checkReminderNotifications, 30 * 1000);
    checkReminderNotifications();
  }

  async function init() {
    initNav();
    initScheduleFilters();
    initScheduleViewToggle();
    initTaskFilters();
    initSearch();
    initAddModal();
    initFitness();
    initNotifications();

    updateClock();
    setInterval(updateClock, 1000);

    await loadAllData();
    renderAll();

    document.getElementById("refreshBtn").addEventListener("click", async () => {
      await loadAllData();
      renderAll();
      if (scheduleViewMode === "calendar") renderScheduleCalendar();
    });

    setInterval(async () => {
      await loadAllData();
      renderAll();
      if (scheduleViewMode === "calendar") renderScheduleCalendar();
    }, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
