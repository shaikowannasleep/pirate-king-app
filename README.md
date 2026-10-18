# Pirate King

Game hải chiến cướp biển 3D chạy trên trình duyệt. Chơi tại **https://shaikowannasleep.github.io/pirate-king-app/** hoặc **https://pirate-king-app.dinhdung1110.workers.dev/**

Repo này là giao diện người chơi (tiêu đề, hải đồ 5 màn, xưởng nâng cấp, cài đặt, HUD). Game runtime và màn chơi được đưa vào từ [pirate-king-editor](https://github.com/shaikowannasleep/pirate-king-editor) bằng `npm run update` bên editor; mỗi lần push lên `main`, workflow `.github/workflows/pages.yml` build và deploy lên GitHub Pages.

- `npm run dev`: chạy thử. `npm run build`: một file `dist/pirate-king.html` chạy offline. `npm run build:site`: bản cho Pages.
- `npm run test:e2e`: kiểm tra bằng Playwright.

Điều khiển: A/D lái, W/S buồm, Q/E bắn mạn trái/phải, Space tự chọn mạn, P tạm dừng. Trên điện thoại có cần lái, nút buồm và hai nút bắn.

## Multiplayer server (Cloudflare Worker)

`worker/` is a Cloudflare Worker (`wrangler.jsonc`, service name `pirate-king-app`) that serves the built site from `dist/` and the multiplayer API under `/api/*`: `POST /api/rooms`, `GET /api/rooms/:code`, `GET /api/rooms/:code/ws` (Durable Object `Room`, WebSocket Hibernation), `GET /api/turn`, `GET /api/health`. CORS allows the GitHub Pages site and localhost. The API contract is in the editor repo's `docs/CONTRACT.md` ("Signaling Worker API").

- Deploy: Workers Builds runs `npx wrangler deploy` on every push; wrangler first runs `npm run build:site` (see `build.command` in `wrangler.jsonc`). Manual: `npm run deploy`. Local: `npm run dev:worker`. Tests: `npm run test:worker`.
- Secrets (Workers & Pages, pirate-king-app, Settings, Variables and Secrets, type Secret): `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. Create the key in the Cloudflare dashboard under Realtime, TURN, Create TURN key, then copy its Key ID and API token. Without them `/api/turn` returns public STUN only (direct connections still work, strict NATs may fail).
- The site is also still deployed to GitHub Pages by `.github/workflows/pages.yml`.
