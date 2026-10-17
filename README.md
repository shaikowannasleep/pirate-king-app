# Pirate King

Game hải chiến cướp biển 3D chạy trên trình duyệt. Chơi tại **https://shaikowannasleep.github.io/pirate-king-app/**

Repo này là giao diện người chơi (tiêu đề, hải đồ 5 màn, xưởng nâng cấp, cài đặt, HUD). Game runtime và màn chơi được đưa vào từ [pirate-king-editor](https://github.com/shaikowannasleep/pirate-king-editor) bằng `npm run update` bên editor; mỗi lần push lên `main`, workflow `.github/workflows/pages.yml` build và deploy lên GitHub Pages.

- `npm run dev`: chạy thử. `npm run build`: một file `dist/pirate-king.html` chạy offline. `npm run build:site`: bản cho Pages.
- `npm run test:e2e`: kiểm tra bằng Playwright.

Điều khiển: A/D lái, W/S buồm, Q/E bắn mạn trái/phải, Space tự chọn mạn, P tạm dừng. Trên điện thoại có cần lái, nút buồm và hai nút bắn.
