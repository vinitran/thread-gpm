# Build Windows portable

Chạy tại thư mục gốc repository:

```sh
node packaging/windows/build.mjs
```

Yêu cầu Node.js 22, npm và mạng để tải runtime/dependencies. Trên macOS dùng `tar` của hệ thống và Rosetta để chạy compiler NSIS x64. Trên Linux cần `tar` hỗ trợ 7z. Trên Windows cần NSIS và biến `MAKENSIS` trỏ tới `makensis.exe`; `NSISDIR` trỏ tới thư mục cài NSIS nếu không dùng compiler tải tự động.

Script chỉ cài dependencies vào `.build/windows/payload`, gồm Node Windows x64 có xác minh SHA-256 từ nodejs.org và thư viện Sharp Windows x64. Không tải Chromium: tool kết nối trình duyệt do GPM quản lý. NSIS tạo một EXE tự giải nén vào thư mục tạm, chạy server và giữ file tạm đến khi server thoát. Dữ liệu được lưu ngoài thư mục tạm tại `%LOCALAPPDATA%\HoanXu-GPM\data`.

Sau khi build, chạy `node packaging/windows/smoke.mjs` để kiểm tra bộ file, kiến trúc PE x64, server với data folder riêng, mở lần hai và shutdown. Smoke test dùng native dependencies của máy build; không xác nhận EXE chạy trên Windows. Cần cài dependencies của `gpm-tool` trên máy build trước khi chạy smoke test.

Kết quả trong `release/`: EXE, checksum SHA-256, manifest và hướng dẫn Windows. Mặc định không đóng gói `gpm-tool/data`, API key, proxy hay lịch sử cá nhân. Đây là bản portable chưa ký số; manifest ghi rõ trạng thái kiểm thử Windows.

Bản build không hỗ trợ nhúng key. Người dùng nhập key trong Cài đặt hoặc đặt `HOANXU_API_KEY` khi khởi chạy; xem [hướng dẫn cấu hình key](../../CAU-HINH-KEY.md).

Từ bản 0.3.7, build có `release-config.json` và manifest cập nhật `hoanxu-windows-x64.json`. Launcher portable truyền đường dẫn EXE và PID NSIS cho helper PowerShell. Sau khi người dùng bấm cài cập nhật và các profile đã dừng, helper đợi portable cũ thoát rồi thay EXE và mở lại; LocalAppData được giữ. Smoke trên runner Windows kiểm tra helper với file giả lập, không chạy Threads. CI/CD và cách cấu hình secret key ở [README đóng gói](../README.md).
