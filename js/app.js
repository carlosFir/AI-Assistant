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
  };

  // ============ Data Loading ============

  async function loadJSON(path) {
    try {
      const res = await fetch(path + "?t=" + Date.now());
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    } catch {
      return [];
    }
  }

  async function loadAllData() {
    const [schedule, tasks, notes, reminders] = await Promise.all([
      loadJSON(DATA_PATHS.schedule),
      loadJSON(DATA_PATHS.tasks),
      loadJSON(DATA_PATHS.notes),
      loadJSON(DATA_PATHS.reminders),
    ]);
    store.schedule = schedule;
    store.tasks = tasks;
    store.notes = notes;
    store.reminders = reminders;
  }

  // ============ Utilities ============

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDateTime(dt) {
    if (!dt) return "-";
    const d = new Date(dt);
    if (isNaN(d)) return dt;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    if (todaySchedules.length === 0) {
      dashSchedule.innerHTML = '<div class="empty-state">今天暂无日程安排</div>';
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
    if (pendingTasks.length === 0) {
      dashTasks.innerHTML = '<div class="empty-state">所有任务已完成 🎉</div>';
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
    if (store.notes.length === 0) {
      dashNotes.innerHTML = '<div class="empty-state">暂无备忘录</div>';
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
    if (activeReminders.length === 0) {
      dashReminders.innerHTML = '<div class="empty-state">暂无活跃提醒</div>';
    } else {
      dashReminders.innerHTML = activeReminders
        .slice(0, 5)
        .map(
          (r) => `
        <div class="dash-item">
          <div>
            <div class="dash-item-title">${escapeHtml(r.title)}</div>
            <div class="dash-item-desc">${formatDateTime(r.datetime)} ${r.repeat && r.repeat !== "once" && r.repeat !== "none" ? "| " + (REPEAT_MAP[r.repeat] || r.repeat) : ""}</div>
          </div>
          <div class="dash-item-badge">${makeBadge(STATUS_MAP[r.status] || r.status, r.status)}</div>
        </div>`
        )
        .join("");
    }
  }

  // ============ Schedule Table ============

  function renderScheduleTable(filterDate) {
    let items = store.schedule;
    if (filterDate) {
      items = items.filter((s) => s.date === filterDate);
    }
    items = items.sort((a, b) => {
      const dc = (a.date || "").localeCompare(b.date || "");
      if (dc !== 0) return dc;
      return (a.time || "").localeCompare(b.time || "");
    });

    const tbody = document.getElementById("scheduleBody");
    const empty = document.getElementById("scheduleEmpty");
    const table = document.getElementById("scheduleTable");

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
  }

  function initScheduleFilters() {
    const dateInput = document.getElementById("scheduleDate");
    const todayBtn = document.getElementById("scheduleTodayBtn");
    const allBtn = document.getElementById("scheduleAllBtn");

    dateInput.value = todayStr();

    dateInput.addEventListener("change", () => {
      renderScheduleTable(dateInput.value || null);
    });
    todayBtn.addEventListener("click", () => {
      dateInput.value = todayStr();
      renderScheduleTable(todayStr());
    });
    allBtn.addEventListener("click", () => {
      dateInput.value = "";
      renderScheduleTable(null);
    });
  }

  // ============ Tasks Table ============

  function renderTasksTable(statusFilter, priorityFilter) {
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
    const empty = document.getElementById("tasksEmpty");
    const table = document.getElementById("tasksTable");

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
    const items = store.reminders.sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return (a.datetime || "").localeCompare(b.datetime || "");
    });

    const tbody = document.getElementById("remindersBody");
    const empty = document.getElementById("remindersEmpty");
    const table = document.getElementById("remindersTable");

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
          <td>${formatDateTime(r.datetime)}</td>
          <td><span class="repeat-label">${REPEAT_MAP[r.repeat] || r.repeat || "不重复"}</span></td>
        </tr>`
        )
        .join("");
    }
  }

  // ============ Render All ============

  function renderAll() {
    renderDashboard();
    renderScheduleTable(document.getElementById("scheduleDate").value || null);
    renderTasksTable(
      document.getElementById("taskFilter").value,
      document.getElementById("taskPriorityFilter").value
    );
    renderNotes();
    renderReminders();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    document.getElementById("lastUpdate").textContent =
      `上次刷新：${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // ============ Init ============

  async function init() {
    initNav();
    initScheduleFilters();
    initTaskFilters();

    updateClock();
    setInterval(updateClock, 1000);

    await loadAllData();
    renderAll();

    document.getElementById("refreshBtn").addEventListener("click", async () => {
      await loadAllData();
      renderAll();
    });

    setInterval(async () => {
      await loadAllData();
      renderAll();
    }, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
