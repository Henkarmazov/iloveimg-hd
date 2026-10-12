
import multer from "multer";
import axios from "axios";
import * as cheerio from "cheerio";
import FormData from "form-data";

export const config = {
  api: {
    bodyParser: false
  },
  maxDuration: 300
};

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) {
      return cb(new Error("File harus berupa gambar."));
    }

    cb(null, true);
  }
});

const SERVERS = [
  "api1g", "api2g", "api3g", "api8g", "api9g",
  "api10g", "api11g", "api12g", "api13g", "api14g",
  "api15g", "api16g", "api17g", "api18g", "api19g",
  "api20g", "api21g", "api22g", "api24g", "api25g"
];

const TASK =
  "r68zl88mq72xq94j2d5p66bn2z9lrbx20njsbw2qsAvgmzr11lvfhAx9kl87pp6yqgx7c8vg7sfbqnrr42qb16v0gj8jl5s0kq1kgp26mdyjjspd8c5A2wk8b4Adbm6vf5tpwbqlqdr8A9tfn7vbqvy28ylphlxdl379psxpd8r70nzs3sk1";

async function getToken() {
  const response = await axios.get(
    "https://www.iloveimg.com/upscale-image",
    {
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    }
  );

  const $ = cheerio.load(response.data);

  const script = $("script")
    .filter((_, el) =>
      $(el).html()?.includes("ilovepdfConfig =")
    )
    .first()
    .html();

  if (!script) {
    throw new Error("Config situs tidak ditemukan.");
  }

  const marker = "ilovepdfConfig = ";
  const start = script.indexOf(marker);

  if (start < 0) {
    throw new Error("Config situs tidak ditemukan.");
  }

  const after = script.slice(start + marker.length);
  const end = after.indexOf(";");

  if (end < 0) {
    throw new Error("Format config situs berubah.");
  }

  const json = JSON.parse(after.slice(0, end));
  const csrf = $('meta[name="csrf-token"]').attr("content");

  if (!json?.token || !csrf) {
    throw new Error("Token/CSRF gagal diambil.");
  }

  return {
    token: json.token,
    csrf
  };
}

async function uploadImage(server, headers, buffer, mimeType) {
  const form = new FormData();

  form.append("name", "image");
  form.append("chunk", "0");
  form.append("chunks", "1");
  form.append("task", TASK);
  form.append("preview", "1");
  form.append("file", buffer, {
    filename: "image",
    contentType: mimeType
  });

  const response = await axios.post(
    `https://${server}.iloveimg.com/v1/upload`,
    form,
    {
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      timeout: 60000,
      maxBodyLength: Infinity
    }
  );

  return response.data;
}

async function imageHD(buffer, scale, mimeType) {
  const { token, csrf } = await getToken();

  const server =
    SERVERS[Math.floor(Math.random() * SERVERS.length)];

  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: "https://www.iloveimg.com",
    Referer: "https://www.iloveimg.com/upscale-image",
    Cookie: `_csrf=${csrf}`,
    "User-Agent": "Mozilla/5.0"
  };

  const uploaded = await uploadImage(
    server,
    headers,
    buffer,
    mimeType
  );

  if (!uploaded?.server_filename) {
    throw new Error(
      "Upload gambar gagal: nama file server tidak ditemukan."
    );
  }

  const form = new FormData();

  form.append("task", TASK);
  form.append("server_filename", uploaded.server_filename);
  form.append("scale", String(scale));

  const response = await axios.post(
    `https://${server}.iloveimg.com/v1/upscale`,
    form,
    {
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      responseType: "arraybuffer",
      timeout: 120000,
      maxBodyLength: Infinity
    }
  );

  return Buffer.from(response.data);
}

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadMiddleware.single("image")(req, res, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      message: "Method hanya menerima POST."
    });
  }

  try {
    await runUpload(req, res);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Pilih gambar dulu."
      });
    }

    const scale = Number(req.body?.scale || 4);

    if (![2, 4].includes(scale)) {
      return res.status(400).json({
        success: false,
        message: "Skala hanya boleh 2x atau 4x."
      });
    }

    const resultBuffer = await imageHD(
      req.file.buffer,
      scale,
      req.file.mimetype
    );

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="upscaled.jpg"'
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Upscale-Scale", `${scale}x`);

    return res.status(200).send(resultBuffer);
  } catch (error) {
    if (
      error instanceof multer.MulterError &&
      error.code === "LIMIT_FILE_SIZE"
    ) {
      return res.status(413).json({
        success: false,
        message: "Ukuran gambar maksimal 4 MB."
      });
    }

    const status = error.response?.status || 500;

    console.error("Upscale error:", error.message);

    return res.status(
      status >= 400 && status < 600 ? status : 500
    ).json({
      success: false,
      message: error.response
        ? `Layanan upscale menolak permintaan (HTTP ${status}).`
        : error.message || "Upscale gagal. Coba lagi."
    });
  }
}
