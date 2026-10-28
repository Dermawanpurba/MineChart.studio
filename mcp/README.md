# MineChart.studio → MCP

Server MCP (Model Context Protocol) supaya AI di Antigravity bisa
mengenali katalog chart MineChart.studio: **13 departemen, 134 chart,
28 tipe** — diekstrak langsung dari `index.html` MineChart.studio v5.0
(kopi lokal yang di-push sebagai commit `73cb082`).

Ada dua server dalam folder ini, memakai `catalog.json` yang sama.
Pilih salah satu sesuai kebutuhan:

| Server | Transport | Dependensi | Untuk |
|---|---|---|---|
| `server.js` | stdio | tanpa dependensi | **A — lokal**, Antigravity di laptop yang sama |
| `server.mjs` | Streamable HTTP (`/mcp`) + stdio (`--stdio`) | `@modelcontextprotocol/sdk`, `express`, `zod` | **B — remote**, deploy di Coolify/VPS lalu diakses Antigravity dari mana saja |

## Yang bisa dilakukan AI lewat tool ini

| Tool | Guna | Server |
|---|---|---|
| `list_departments` | 13 departemen + jumlah chart tiap departemen | keduanya |
| `list_chart_types` | 28 tipe chart | keduanya |
| `search_charts` | Cari chart dari kata kunci / departemen / tipe, mis. "chart apa untuk MTTR?" | keduanya |
| `get_chart` | Detail 1 chart lengkap dengan `cfg` (bentuk datanya), supaya AI meniru strukturnya | keduanya (`server.js`: pakai `department` + `index`/`title`; `server.mjs`: pakai `chart_id` mis. `plant-0`) |
| `describe_chart_type` | Satu tipe chart: departemen pemakai, gabungan key `cfg`, + satu contoh `cfg` lengkap | `server.mjs` saja |

Resource tambahan di `server.mjs`: `minechart://catalog` (seluruh katalog
sebagai JSON).

## Cara pasang — A: lokal / stdio (`server.js`, tanpa dependensi)

1. Salin folder `minechart-mcp` ini ke laptop.
2. Pastikan Node.js terpasang (`node --version`).
3. Di Antigravity: Settings → Customizations → **Open MCP Config**
   (buka `mcp_config.json` lewat UI ini, jangan menebak path-nya —
   lokasi file ini berbeda-beda antar instalasi).
4. Tambahkan isi `mcp_config.example.json`, ganti
   `<ABSOLUTE_PATH_KE_FOLDER>` dengan path absolut folder ini di laptop.
5. Simpan, refresh daftar MCP server di Antigravity, lalu coba tanya:
   "Pakai tool minechart-studio, chart apa yang cocok untuk MTTR?"

## Cara pasang — B: remote / HTTP (`server.mjs`, Coolify + VPS)

1. Folder ini (`mcp/`) di-push ke repo `MineChart.studio` bersama
   `index.html` — situs GitHub Pages tetap jalan seperti biasa.
2. Di Coolify: **Add Resource → Application → GitHub**, pilih repo
   `MineChart.studio`, branch `main`.
3. **Base Directory:** `/mcp` — **Build Pack:** Dockerfile — **Port:** `3000`.
4. **Environment Variables:** `PORT=3000`, dan `MCP_API_KEY=<kunci-acak-panjang>`
   (sangat disarankan; tanpanya endpoint `/mcp` terbuka tanpa auth).
5. **Domains → Add domain → Generate domain**, pilih protocol `https`,
   lalu **Deploy**. Coolify akan membuatkan domain `*.sslip.io` dari IP
   server (atau isi domain sendiri kapan saja, tanpa mengubah kode).
6. Cek `https://<domain>/health` — harus menjawab `{"ok": true, ...}`.
7. Di Antigravity, tambahkan ke `mcp_config.json`:

```json
{
  "mcpServers": {
    "minechart-studio": {
      "serverUrl": "https://<domain-sslip-io-atau-domainmu>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY-yang-sama-dengan-di-Coolify>"
      }
    }
  }
}
```

## Regenerasi katalog

Kalau `index.html` (situsnya) berubah, jalankan dari folder ini:

```bash
node extract-catalog.mjs   # membaca ../index.html -> ./catalog.json
```

lalu commit `catalog.json` yang baru. Skrip ini memakai scanner
string-aware + evaluasi literal `DEPARTMENTS` saja; tidak menjalankan
kode halaman.

## Menjalankan lokal (server HTTP)

```bash
npm ci
npm start            # HTTP di :3000, cek GET /health
npm run stdio        # mode stdio via SDK (setara server.js)
```

## Batasan yang jujur

- **Data Sampel, bukan live.** AI hanya kenal jenis chart & bentuk
  datanya, bukan angka produksi real-time.
- **Bukan kode render.** Katalog ini tidak membawa kode HTML/CSS
  per chart dari situsnya; `cfg` tiap chart bentuknya beda-beda
  (cek key-nya sebelum dipakai). Kalau AI perlu snippet siap tempel,
  itu pekerjaan lanjutan: mengekstrak renderer situsnya.
- **GitHub Pages tidak bisa jadi MCP.** Situsnya tetap statis;
  server MCP jalan terpisah (di laptop untuk mode A, di VPS untuk
  mode B).

## File

- `server.js` — server stdio tanpa dependensi (mode A)
- `server.mjs` — server Express + MCP SDK, Streamable HTTP + stdio (mode B)
- `catalog.json` — katalog hasil ekstrak (sumber: `DEPARTMENTS` di `index.html`)
- `extract-catalog.mjs` — skrip regenerasi katalog
- `Dockerfile` — image `node:20-alpine`, healthcheck ke `/health` (mode B)
- `package.json` / `package-lock.json` — `@modelcontextprotocol/sdk`, `express`, `zod` (mode B)
- `mcp_config.example.json` — contoh config Antigravity mode A (stdio)
