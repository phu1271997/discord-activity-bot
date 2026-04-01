# Discord Message Tracker & Auto Role

Bot đếm tin nhắn hàng tuần và tự động gán role theo hiệu suất hoạt động.

## Tính năng
- Đếm tin nhắn trong các channel chỉ định.
- Tự động Reset và gán role vào 23:59 Chủ Nhật hàng tuần (Giờ VN).
- Tự động bỏ qua các role Mod/Elite.

## Cách chạy Local
1. Cài đặt [Node.js](https://nodejs.org/).
2. Tải code về và chạy `npm install`.
3. Tạo file `.env` và điền các thông số.
4. Chạy lệnh: `npm start`.

## Cách Deploy lên Railway
1. Push code lên một repo GitHub (Private hoặc Public).
2. Lên [Railway.app](https://railway.app/), chọn "New Project" -> "GitHub Repo".
3. Vào phần **Variables** trên Railway, copy các biến từ file `.env` vào đó.
4. Railway sẽ tự động nhận diện `package.json` và chạy bot.

## Lưu ý quan trọng
- **Quyền hạn:** Bot cần có quyền `Manage Roles`.
- **Thứ tự Role:** Trong Discord Settings, role của Bot **PHẢI** nằm cao hơn các role `Khầy` và `Contributor` thì mới có thể add/remove được.