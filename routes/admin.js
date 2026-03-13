import { Router } from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import supabase from "../lib/supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

// POST /api/admin/login
router.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(503).json({ error: "Admin not configured" });
  }

  if (password === adminPassword) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

// POST /api/admin/logout
router.post("/api/admin/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/admin/check — check if logged in
router.get("/api/admin/check", (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

// GET /api/admin/orders — list all orders
router.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data: orders, error, count } = await query;

    if (error) {
      console.error("Orders fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch orders" });
    }

    res.json({ orders, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error("Admin orders error:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// GET /api/admin/orders/:orderId — get full order detail
router.get("/api/admin/orders/:orderId", requireAdmin, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", req.params.orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { data: entries, error: entriesError } = await supabase
      .from("letter_entries")
      .select("*")
      .eq("order_id", order.id)
      .order("letter");

    if (entriesError) {
      console.error("Entries fetch error:", entriesError);
      return res.status(500).json({ error: "Failed to fetch order entries" });
    }

    res.json({ order, entries });
  } catch (error) {
    console.error("Admin order detail error:", error);
    res.status(500).json({ error: "Failed to fetch order detail" });
  }
});

// PATCH /api/admin/orders/:orderId/status — update order status
router.patch(
  "/api/admin/orders/:orderId/status",
  requireAdmin,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(503).json({ error: "Database not configured" });
      }

      const { status } = req.body;
      const validStatuses = ["submitted", "in_progress", "printed", "shipped"];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const { data: order, error } = await supabase
        .from("orders")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", req.params.orderId)
        .select()
        .single();

      if (error || !order) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json({ success: true, order });
    } catch (error) {
      console.error("Status update error:", error);
      res.status(500).json({ error: "Failed to update status" });
    }
  }
);

// GET /api/admin/export/:orderId — export order data as JSON
router.get("/api/admin/export/:orderId", requireAdmin, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("*")
      .eq("id", req.params.orderId)
      .single();

    const { data: entries } = await supabase
      .from("letter_entries")
      .select("*")
      .eq("order_id", req.params.orderId)
      .order("letter");

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="order-${order.order_number}.json"`
    );
    res.json({ order, entries });
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Failed to export order" });
  }
});

// GET /admin — serve admin page
router.get("/admin", (_req, res) => {
  res.sendFile(join(__dirname, "..", "public", "admin.html"));
});

export default router;
