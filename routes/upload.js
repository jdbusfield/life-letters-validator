import { Router } from "express";
import multer from "multer";
import { extname } from "path";
import supabase from "../lib/supabase.js";
import { checkUploadedPhoto } from "../lib/imageCheck.js";

const router = Router();

// Use memory storage — files go to Supabase Storage, not local disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    if (allowed.test(extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(
        new Error("Only image files (JPG, PNG, GIF, WebP, HEIC) are allowed")
      );
    }
  },
});

// POST /api/upload/:letter — upload a photo for a letter
router.post("/api/upload/:letter", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Quality gate: reject low-resolution photos (and, when enabled via
    // PHOTO_REQUIRE_TRANSPARENT, photos without a transparent background).
    const check = checkUploadedPhoto(req.file.buffer);
    if (!check.ok) {
      return res.status(422).json({ error: check.reason });
    }

    const letter = req.params.letter.toUpperCase();
    const orderNumber = req.query.order || "unassigned";
    const ext = extname(req.file.originalname).toLowerCase() || ".jpg";
    const storagePath = `orders/${orderNumber}/${letter}${ext}`;

    if (!supabase) {
      // Fallback: return a placeholder URL if Supabase isn't configured
      return res.json({
        success: true,
        letter,
        url: null,
        storagePath: null,
        size: req.file.size,
        message: "Database not configured — photo accepted but not stored",
      });
    }

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("letter-photos")
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true, // overwrite if exists
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ error: "Failed to upload photo" });
    }

    // Get the public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("letter-photos").getPublicUrl(storagePath);

    res.json({
      success: true,
      letter,
      url: publicUrl,
      storagePath,
      size: req.file.size,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/upload/:letter — remove a previously uploaded photo
router.delete("/api/upload/:letter", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const letter = req.params.letter.toUpperCase();
    const orderNumber = req.query.order || "unassigned";

    // List files in the order folder matching this letter
    const { data: files } = await supabase.storage
      .from("letter-photos")
      .list(`orders/${orderNumber}`, {
        search: letter,
      });

    if (files && files.length > 0) {
      const paths = files
        .filter((f) => f.name.startsWith(letter))
        .map((f) => `orders/${orderNumber}/${f.name}`);

      if (paths.length > 0) {
        await supabase.storage.from("letter-photos").remove(paths);
      }
    }

    res.json({ success: true, letter });
  } catch (error) {
    console.error("Delete upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
