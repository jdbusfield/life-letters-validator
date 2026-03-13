// ============================================
// Life Letters — Admin Dashboard
// ============================================

let currentPage = 1;
let currentStatus = "all";
const PAGE_SIZE = 20;

// ---- Init ----

document.addEventListener("DOMContentLoaded", async () => {
  // Check if already logged in
  const res = await fetch("/api/admin/check");
  const { authenticated } = await res.json();

  if (authenticated) {
    showDashboard();
  }

  // Login form
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("detailModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("detailModal")) closeModal();
  });

  // Status tabs
  document.querySelectorAll(".status-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".status-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentStatus = tab.dataset.status;
      currentPage = 1;
      loadOrders();
    });
  });
});

// ---- Auth ----

async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      errorEl.textContent = "Invalid password. Please try again.";
      return;
    }

    showDashboard();
  } catch {
    errorEl.textContent = "Login failed. Please try again.";
  }
}

async function handleLogout() {
  await fetch("/api/admin/logout", { method: "POST" });
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("loginPassword").value = "";
}

function showDashboard() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  loadOrders();
}

// ---- Orders ----

async function loadOrders() {
  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: PAGE_SIZE,
      status: currentStatus,
    });

    const res = await fetch(`/api/admin/orders?${params}`);
    if (!res.ok) throw new Error("Failed to load orders");

    const { orders, total } = await res.json();
    renderOrders(orders);
    renderPagination(total);
  } catch (err) {
    console.error("Load orders error:", err);
    document.getElementById("ordersBody").innerHTML = "";
    document.getElementById("emptyState").style.display = "block";
    document.getElementById("emptyState").textContent = "Failed to load orders.";
  }
}

function renderOrders(orders) {
  const tbody = document.getElementById("ordersBody");
  const empty = document.getElementById("emptyState");

  if (!orders || orders.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = "No orders found.";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = orders
    .map(
      (o) => `
    <tr>
      <td><strong>${esc(o.order_number)}</strong></td>
      <td>${esc(o.customer_name || "—")}</td>
      <td>${esc(o.customer_email)}</td>
      <td><span class="style-badge">${esc(o.letter_style)}</span></td>
      <td><span class="status-badge status-${o.status}">${formatStatus(o.status)}</span></td>
      <td>${formatDate(o.created_at)}</td>
      <td>
        <button class="btn btn-small" onclick="viewOrder('${o.id}')">View</button>
        <button class="btn btn-small" onclick="exportOrder('${o.id}')">Export</button>
      </td>
    </tr>
  `
    )
    .join("");
}

function renderPagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const container = document.getElementById("pagination");

  if (pages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";
  for (let i = 1; i <= pages; i++) {
    html += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="goToPage(${i})">${i}</button>`;
  }
  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadOrders();
}

// ---- Order Detail ----

async function viewOrder(orderId) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}`);
    if (!res.ok) throw new Error("Failed to load order");

    const { order, entries } = await res.json();
    renderOrderDetail(order, entries);
    document.getElementById("detailModal").classList.add("show");
  } catch (err) {
    console.error("View order error:", err);
    alert("Failed to load order details.");
  }
}

function renderOrderDetail(order, entries) {
  const statusFlow = ["submitted", "in_progress", "printed", "shipped"];
  const currentIdx = statusFlow.indexOf(order.status);
  const nextStatus = currentIdx < statusFlow.length - 1 ? statusFlow[currentIdx + 1] : null;

  let html = `
    <h2>Order: ${esc(order.order_number)}</h2>
    <div class="detail-meta">
      <div><strong>Customer:</strong> ${esc(order.customer_name || "—")}</div>
      <div><strong>Email:</strong> ${esc(order.customer_email)}</div>
      <div><strong>Style:</strong> ${esc(order.letter_style)}</div>
      <div><strong>Status:</strong> <span class="status-badge status-${order.status}">${formatStatus(order.status)}</span></div>
      <div><strong>Created:</strong> ${formatDate(order.created_at)}</div>
    </div>
    ${
      nextStatus
        ? `<button class="btn btn-primary btn-small" onclick="updateStatus('${order.id}', '${nextStatus}')">
            Mark as ${formatStatus(nextStatus)}
          </button>`
        : '<span class="completed-label">Order complete</span>'
    }
    <h3>Letter Entries</h3>
    <div class="entries-grid">
      ${(entries || [])
        .map(
          (e) => `
        <div class="entry-card ${e.is_default ? "entry-default" : ""}">
          <div class="entry-letter">${esc(e.letter)}</div>
          <div class="entry-body">
            <div class="entry-word">${esc(e.word)}</div>
            <div class="entry-status">${e.is_default ? "Default" : e.validation_status}</div>
          </div>
          ${
            e.photo_url
              ? `<img class="entry-photo" src="${esc(e.photo_url)}" alt="${esc(e.letter)}">`
              : '<div class="entry-no-photo">No photo</div>'
          }
        </div>
      `
        )
        .join("")}
    </div>
  `;

  document.getElementById("detailContent").innerHTML = html;
}

async function updateStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!res.ok) throw new Error("Failed to update status");

    // Refresh detail and list
    await viewOrder(orderId);
    loadOrders();
  } catch (err) {
    console.error("Update status error:", err);
    alert("Failed to update order status.");
  }
}

async function exportOrder(orderId) {
  window.open(`/api/admin/export/${orderId}`, "_blank");
}

function closeModal() {
  document.getElementById("detailModal").classList.remove("show");
}

// ---- Helpers ----

function formatStatus(status) {
  const labels = {
    submitted: "Submitted",
    in_progress: "In Progress",
    printed: "Printed",
    shipped: "Shipped",
  };
  return labels[status] || status;
}

function formatDate(isoDate) {
  if (!isoDate) return "—";
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
